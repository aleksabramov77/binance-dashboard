import { MIRROR } from "../config/mirror";
import type { ActiveMirror, MirrorOrderRequest } from "../lib/planMirror";
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
  market: "spot" | "futures";
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
  hasSymbol: (market: "spot" | "futures", symbol: string) => Promise<boolean>;
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

/**
 * Один прогон: сначала закрыть демо-позиции закрытых paper-сделок (освобождает символы),
 * затем открыть зеркала свежих входов. Сделка «захватывается» до запроса к бирже —
 * параллельный прогон её не повторит.
 */
export async function runMirror<
  C extends MirrorCloseItem,
  R extends MirrorOpenResult,
>(deps: MirrorDeps<C, R>): Promise<MirrorRunResult> {
  const result: MirrorRunResult = {
    configured: deps.configured,
    opened: [],
    skipped: 0,
    deferred: 0,
    deferredCloses: 0,
    swept: [],
    closed: [],
  };
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
  if (candidates.some((c) => c.market === "futures"))
    futuresMode = await deps.positionMode().catch(() => null);
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
    if (!(await deps.claim(d.tradeId))) continue;
    if (d.kind === "skip") {
      await deps.markSkipped(d.tradeId, d.reason);
      result.skipped++;
      continue;
    }
    const r = await deps.open(d.request);
    await deps.saveOpen(d.tradeId, r);
    result.opened.push({
      tradeId: d.tradeId,
      symbol: d.request.symbol,
      status: r.status,
    });
  }
  return result;
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
