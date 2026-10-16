import { MIRROR } from "../config/mirror";
import type {
  ActiveMirror,
  MirrorDecision,
  MirrorOrderRequest,
} from "../lib/planMirror";
import {
  listingKey,
  type MirrorListing,
  type MirrorTradeInput,
  planMirror,
} from "../lib/planMirror";

// Прогон demo-зеркала (spec 008). Хранилище и биржа — зависимости: их собирает
// src/app/server/demoMirror.ts (feature не импортирует feature execute-trade).

export interface MirrorStep {
  label: string;
  ok: boolean;
  detail: string;
}

/** Демо-позиция на закрытие. Остальные поля (свои ордера) runMirror не читает — передаёт в close. */
export interface MirrorCloseItem {
  tradeId: string;
  market: "spot" | "usdm";
  symbol: string;
  direction: "long" | "short";
  quantity: number;
}

/** Итог входа. Остальные поля (свои ордера) runMirror не читает — передаёт в saveOpen. */
export interface MirrorOpenResult {
  id: string;
  status: "protected" | "unprotected" | "rejected";
  message: string;
  entryPrice: number | null;
  filledQuantity: number | null;
  steps: MirrorStep[];
}

export interface MirrorDeps<
  C extends MirrorCloseItem = MirrorCloseItem,
  R extends MirrorOpenResult = MirrorOpenResult,
> {
  now: () => number;
  /** Ключ Binance Demo задан — иначе прогон ничего не делает. */
  configured: boolean;
  listCandidates: (since: Date) => Promise<MirrorTradeInput[]>;
  /** Зеркала, которые держат или открывают позицию: монета и сторона (лимит на монету, встречные). */
  activeMirrors: () => Promise<ActiveMirror[]>;
  /**
   * Режим позиций демо-фьючерсов: в One-way встречная сторона по монете — пропуск, в Hedge — вход.
   * Исключение — режим неизвестен: встречные кандидаты ждут следующего прогона.
   */
  positionMode: () => Promise<"oneway" | "hedge">;
  /**
   * Есть ли символ на демо-рынке: false — точно нет (вход пропускается), исключение — сеть
   * (кандидат ждёт следующего прогона). Проверяется до захвата сделки и запроса на вход.
   */
  hasSymbol: (market: "spot" | "usdm", symbol: string) => Promise<boolean>;
  /**
   * Свободные USDT демо-кошелька группы (Spot — free, USDⓈ-M — availableBalance) для резерва MIRROR.minFreeUsd
   * (spec 0043). Читается раз за прогон на рынок и только если есть вход; исключение — входы идут без проверки.
   */
  freeUsd: (market: "spot" | "usdm") => Promise<number>;
  /** Захват сделки (вставка pending). false — её уже взял другой прогон. */
  claim: (tradeId: string) => Promise<boolean>;
  open: (req: MirrorOrderRequest) => Promise<R>;
  /** Отметить захваченную сделку пропущенной (не открывалась). */
  markSkipped: (tradeId: string, reason: string) => Promise<void>;
  saveOpen: (tradeId: string, result: R) => Promise<void>;
  /**
   * Сверка своих ног открытых зеркал: своя нога сработала — вторая снимается, строка закрыта биржей
   * (не дожидаясь paper-сделки). Возвращает такие зеркала; сбой — пусто (повтор на следующем прогоне).
   */
  sweepLegs: (
    overBudget: () => boolean,
  ) => Promise<{ tradeId: string; symbol: string }[]>;
  /** id демо-позиций на закрытие (без захвата). */
  listToClose: () => Promise<string[]>;
  /** Захват одной позиции на закрытие; null — её уже взял другой прогон. */
  claimToClose: (tradeId: string) => Promise<C | null>;
  close: (item: C) => Promise<{
    status: "closed" | "failed";
    message: string;
    steps: MirrorStep[];
    exitPrice: number | null;
  }>;
  saveClose: (
    tradeId: string,
    result: Awaited<ReturnType<MirrorDeps<C, R>["close"]>>,
  ) => Promise<void>;
}

export interface MirrorRunResult {
  configured: boolean;
  /** Прогон не выполнялся: идёт предыдущий (блокировка прогона, PR 2e). */
  locked: boolean;
  opened: { tradeId: string; symbol: string; status: string }[];
  skipped: number;
  /** Входы, не начатые из-за бюджета времени прогона, — их возьмёт следующий прогон. */
  deferred: number;
  /** Закрытия, не начатые из-за бюджета времени, — следующему прогону. */
  deferredCloses: number;
  /** Закрыты биржей своей ногой (вторая нога снята) до закрытия paper-сделки. */
  swept: { tradeId: string; symbol: string }[];
  closed: { tradeId: string; symbol: string; status: string }[];
}

/** Пустой итог прогона (ничего не делалось): нет ключа демо или прогон уже идёт (locked). */
export const emptyMirrorRunResult = (
  configured: boolean,
  locked = false,
): MirrorRunResult => ({
  configured,
  locked,
  opened: [],
  skipped: 0,
  deferred: 0,
  deferredCloses: 0,
  swept: [],
  closed: [],
});

/**
 * Один прогон: сначала закрыть демо-позиции закрытых paper-сделок (освобождает символы),
 * затем открыть зеркала свежих входов. Сделка «захватывается» до запроса к бирже —
 * параллельный прогон её не повторит.
 */
export async function runMirror<
  C extends MirrorCloseItem,
  R extends MirrorOpenResult,
>(deps: MirrorDeps<C, R>): Promise<MirrorRunResult> {
  const result = emptyMirrorRunResult(deps.configured);
  if (!deps.configured) return result;
  const startedAt = deps.now();
  const overBudget = () => deps.now() - startedAt > MIRROR.runBudgetMs;

  // Сначала свои ноги: висящий reduceOnly-ордер сработавшего зеркала закрыл бы объём соседнего.
  result.swept = await deps.sweepLegs(overBudget);

  // Захват по одному: после бюджета строки не уходят в closing и достаются следующему прогону.
  const toClose = await deps.listToClose();
  for (const [i, tradeId] of toClose.entries()) {
    if (overBudget()) {
      result.deferredCloses = toClose.length - i;
      break;
    }
    const m = await deps.claimToClose(tradeId);
    if (!m) continue;
    const r = await deps.close(m);
    await deps.saveClose(m.tradeId, r);
    result.closed.push({
      tradeId: m.tradeId,
      symbol: m.symbol,
      status: r.status,
    });
  }

  const now = deps.now();
  const candidates = await deps.listCandidates(new Date(now - 60 * 60_000));
  let futuresMode: "oneway" | "hedge" | null = null;
  if (candidates.some((c) => c.market === "usdm"))
    futuresMode = await deps.positionMode().catch(() => null);
  // Расход входа на резерв — оценка по paper-объёму (~$50): на USDⓈ-M уходит маржа (плечо 1 — тот же объём), а
  // fitMinNotional может поднять заявку до минимума символа (до 3×). Для резерва в $500 такой точности хватает.
  const notional = new Map(
    candidates.map((c) => [c.tradeId, c.quantity * c.entryPrice]),
  );
  const reserve = freeFunds(deps);
  const decisions = planMirror(
    candidates,
    await deps.activeMirrors(),
    now,
    await checkListing(deps, candidates),
    futuresMode,
  );
  for (const [i, d] of decisions.entries()) {
    // Бюджет исчерпан — не захватываем ничего, в том числе пропуски: план следующего прогона
    // учтёт, что отложенные входы не открылись (лимит на монету, встречные стороны).
    if (overBudget()) {
      result.deferred = decisions.length - i;
      break;
    }
    // Резерв демо-кошелька (spec 0043) — до захвата: пропуск по нему отмечается, как остальные.
    const step =
      d.kind === "open"
        ? await reserve.check(d, notional.get(d.tradeId) ?? 0)
        : d;
    if (!(await deps.claim(step.tradeId))) continue;
    if (step.kind === "skip") {
      await deps.markSkipped(step.tradeId, step.reason);
      result.skipped++;
      continue;
    }
    const r = await deps.open(step.request);
    if (r.status !== "rejected")
      reserve.spend(step.request.market, notional.get(step.tradeId) ?? 0);
    await deps.saveOpen(step.tradeId, r);
    result.opened.push({
      tradeId: step.tradeId,
      symbol: step.request.symbol,
      status: r.status,
    });
  }
  return result;
}

/**
 * Резерв демо-кошелька прогона (spec 0043): остаток читается один раз на рынок и только при первом входе, каждый
 * вход прогона вычитает свой объём (paper-объём, ~$50). Остаток не прочитался — входы идут как раньше.
 */
function freeFunds(deps: Pick<MirrorDeps, "freeUsd">) {
  const left = new Map<"spot" | "usdm", Promise<number | null>>();
  const read = (market: "spot" | "usdm") => {
    let value = left.get(market);
    if (!value) {
      value = Promise.resolve()
        .then(() => deps.freeUsd(market))
        .catch(() => null);
      left.set(market, value);
    }
    return value;
  };
  return {
    /** Вход или пропуск «мало свободных средств», если после входа останется меньше резерва. */
    async check(
      d: Extract<MirrorDecision, { kind: "open" }>,
      cost: number,
    ): Promise<MirrorDecision> {
      const free = await read(d.request.market);
      if (free === null || free - cost >= MIRROR.minFreeUsd) return d;
      return {
        tradeId: d.tradeId,
        kind: "skip",
        // Остаток после входа; свободных меньше объёма входа — $0, а не отрицательная сумма.
        reason: `мало свободных средств на демо: $${Math.max(0, Math.round(free - cost))} < резерв $${MIRROR.minFreeUsd}`,
      };
    },
    spend(market: "spot" | "usdm", cost: number) {
      const value = left.get(market);
      if (value)
        left.set(
          market,
          value.then((v) => (v === null ? null : v - cost)),
        );
    },
  };
}

/** Проверка символов кандидатов на демо: по разу на market:symbol. */
async function checkListing(
  deps: Pick<MirrorDeps, "hasSymbol">,
  candidates: MirrorTradeInput[],
): Promise<MirrorListing> {
  const listing: MirrorListing = { missing: new Set(), unknown: new Set() };
  const seen = new Set<string>();
  for (const t of candidates) {
    const k = listingKey(t);
    if (seen.has(k) || !t.symbol.endsWith("USDT")) continue;
    seen.add(k);
    try {
      if (!(await deps.hasSymbol(t.market, t.symbol))) listing.missing.add(k);
    } catch {
      listing.unknown.add(k);
    }
  }
  return listing;
}
