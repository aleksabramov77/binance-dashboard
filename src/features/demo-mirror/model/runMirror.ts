import { MIRROR } from "../config/mirror";
import type {
  ActiveMirror,
  MirrorDecision,
  MirrorOrderRequest,
} from "../lib/planMirror";
import {
  coinmMarginCoin,
  type FuturesModes,
  listingKey,
  type MirrorFuturesMarket,
  type MirrorListing,
  type MirrorMarket,
  type MirrorPlanPolicy,
  type MirrorTradeInput,
  planMirror,
  tradablePair,
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
  market: MirrorMarket;
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
   * Режим позиций демо-фьючерсов рынка (у USDⓈ-M и COIN-M свой): в One-way встречная сторона по монете — пропуск, в
   * Hedge — вход. Исключение — режим неизвестен: встречные кандидаты ждут следующего прогона.
   */
  positionMode: (market: MirrorFuturesMarket) => Promise<"oneway" | "hedge">;
  /**
   * Есть ли символ на демо-рынке: false — точно нет (вход пропускается), исключение — сеть
   * (кандидат ждёт следующего прогона). Проверяется до захвата сделки и запроса на вход.
   */
  hasSymbol: (market: MirrorMarket, symbol: string) => Promise<boolean>;
  /**
   * Свободные деньги демо-кошелька для резерва, $: Spot — free USDT, USDⓈ-M — availableBalance USDT (резерв
   * MIRROR.minFreeUsd, spec 0043); COIN-M — свободная маржа монеты контракта symbol × её цена (резерв
   * MIRROR.coinmMinFreeUsd, spec 0056). Читается раз за прогон на кошелёк и только если есть вход; исключение — входы
   * этого кошелька идут без проверки.
   */
  freeUsd: (market: MirrorMarket, symbol: string) => Promise<number>;
  /**
   * Захват сделки (вставка pending). false — её уже взял другой прогон. kind — что будет дальше: вход или пропуск
   * (реальное зеркало пишет пропуск одной вставкой в markSkipped, spec 0049; демо kind не читает).
   */
  claim: (tradeId: string, kind: MirrorDecision["kind"]) => Promise<boolean>;
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
  /** Остановка процесса запрошена: новые входы и закрытия не начинаются, начатые доделываются (spec 0049). */
  stopRequested?: () => boolean;
  /** Лимит на монету и тексты пропусков площадки; нет — демо (DEMO_MIRROR_POLICY). */
  policy?: MirrorPlanPolicy;
  /**
   * Проверка входа перед захватом (spec 0049, реальное зеркало: лимиты, стоп, объём, средства) вместо резерва демо
   * (MIRROR.minFreeUsd). Вход — как есть или с новым объёмом, пропуск с причиной, null — кандидат ждёт следующего
   * прогона (не прочитали состояние — не входим). spend — вход отправлен (не rejected).
   */
  gate?: {
    check: (
      d: Extract<MirrorDecision, { kind: "open" }>,
    ) => Promise<MirrorDecision | null>;
    spend: (d: Extract<MirrorDecision, { kind: "open" }>) => void;
  };
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
  // Бюджет времени или запрошена остановка (воркер реального счёта на SIGTERM): начатое доделывается, новое — нет.
  const overBudget = () =>
    deps.now() - startedAt > MIRROR.runBudgetMs ||
    (deps.stopRequested?.() ?? false);

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
  // Режим позиций — только рынков, у которых есть кандидаты (у USDⓈ-M и COIN-M он свой).
  const futuresModes: FuturesModes = { usdm: null, coinm: null };
  for (const market of ["usdm", "coinm"] as const)
    if (candidates.some((c) => c.market === market))
      futuresModes[market] = await deps.positionMode(market).catch(() => null);
  // Расход входа на резерв — оценка по paper-объёму (~$50): на USDⓈ-M уходит маржа (плечо 1 — тот же объём), а
  // fitMinNotional может поднять заявку до минимума символа (до 3×). Для резерва в $500 такой точности хватает.
  // COIN-M: paper-объём — ровно контракты × размер, маржа при плече 1 — столько же в монете контракта.
  const notional = new Map(
    candidates.map((c) => [c.tradeId, c.quantity * c.entryPrice]),
  );
  const reserve = freeFunds(deps);
  const decisions = planMirror(
    candidates,
    await deps.activeMirrors(),
    now,
    await checkListing(deps, candidates),
    futuresModes,
    deps.policy,
  );
  for (const [i, d] of decisions.entries()) {
    // Бюджет исчерпан — не захватываем ничего, в том числе пропуски: план следующего прогона
    // учтёт, что отложенные входы не открылись (лимит на монету, встречные стороны).
    if (overBudget()) {
      result.deferred = decisions.length - i;
      break;
    }
    // Резерв демо-кошелька (spec 0043) или проверки реального счёта (gate, spec 0049) — до захвата: пропуск по ним
    // отмечается, как остальные; null — кандидат ждёт следующего прогона.
    const step =
      d.kind !== "open"
        ? d
        : deps.gate
          ? await deps.gate.check(d)
          : await reserve.check(d, notional.get(d.tradeId) ?? 0);
    if (!step) continue;
    if (!(await deps.claim(step.tradeId, step.kind))) continue;
    if (step.kind === "skip") {
      await deps.markSkipped(step.tradeId, step.reason);
      result.skipped++;
      continue;
    }
    const r = await deps.open(step.request);
    if (r.status !== "rejected") {
      if (deps.gate) deps.gate.spend(step);
      else reserve.spend(step.request, notional.get(step.tradeId) ?? 0);
    }
    await deps.saveOpen(step.tradeId, r);
    result.opened.push({
      tradeId: step.tradeId,
      symbol: step.request.symbol,
      status: r.status,
    });
  }
  return result;
}

/** Кошелёк резерва: Spot и USDⓈ-M — свой рынок, COIN-M — монета маржи контракта (spec 0056). */
const walletOf = (r: Pick<MirrorOrderRequest, "market" | "symbol">) =>
  r.market === "coinm" ? `coinm:${coinmMarginCoin(r.symbol)}` : r.market;

/** $0,30 — копейки видны: у COIN-M свободной маржи монеты бывает меньше доллара. */
const cents = (usd: number) => `$${usd.toFixed(2).replace(".", ",")}`;

/**
 * Резерв демо-кошелька прогона (spec 0043, 0056): остаток читается один раз на кошелёк (Spot, USDⓈ-M, монета COIN-M) и
 * только при первом входе, каждый вход прогона вычитает свой объём (paper-объём, ~$50). Остаток не прочитался — входы
 * идут как раньше.
 */
function freeFunds(deps: Pick<MirrorDeps, "freeUsd">) {
  const left = new Map<string, Promise<number | null>>();
  const read = (r: MirrorOrderRequest) => {
    const key = walletOf(r);
    let value = left.get(key);
    if (!value) {
      value = Promise.resolve()
        .then(() => deps.freeUsd(r.market, r.symbol))
        .catch(() => null);
      left.set(key, value);
    }
    return value;
  };
  return {
    /** Вход или пропуск «мало свободных средств», если после входа останется меньше резерва. */
    async check(
      d: Extract<MirrorDecision, { kind: "open" }>,
      cost: number,
    ): Promise<MirrorDecision> {
      const free = await read(d.request);
      const coinm = d.request.market === "coinm";
      const reserve = coinm ? MIRROR.coinmMinFreeUsd : MIRROR.minFreeUsd;
      if (free === null || free - cost >= reserve) return d;
      return {
        tradeId: d.tradeId,
        kind: "skip",
        reason: coinm
          ? // Монета, её свободная маржа и что нужно: резерв + маржа входа (плечо 1 — объём входа).
            `мало свободной маржи ${coinmMarginCoin(d.request.symbol)} на демо: ${cents(free)} < резерв $${reserve} + вход ~${cents(cost)}`
          : // Остаток после входа; свободных меньше объёма входа — $0, а не отрицательная сумма.
            `мало свободных средств на демо: $${Math.max(0, Math.round(free - cost))} < резерв $${reserve}`,
      };
    },
    spend(r: MirrorOrderRequest, cost: number) {
      const key = walletOf(r);
      const value = left.get(key);
      if (value)
        left.set(
          key,
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
    // Пара не та (не к USDT, у COIN-M — не …USD_PERP) — планировщик сам пропустит её с причиной.
    if (seen.has(k) || !tradablePair(t)) continue;
    seen.add(k);
    try {
      if (!(await deps.hasSymbol(t.market, t.symbol))) listing.missing.add(k);
    } catch {
      listing.unknown.add(k);
    }
  }
  return listing;
}
