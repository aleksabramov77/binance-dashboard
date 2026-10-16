import { LIVE, LIVE_SKIP } from "../config/liveMirror";
import { liveUsd as usd } from "./money";

// Проверки реального входа до захвата сделки и до запроса на биржу (spec 0049, AC2, AC3): аварийный стоп, лимит
// позиций субсчёта, дневной лимит убытка эксперимента, режим фьючерсов, объём $10 (до минимума биржи ≤ $50) и
// свободные USDT кошелька. Сеть и состояние внедряются: не прочитали — вход не идёт (кандидат ждёт прогона).

type Market = "spot" | "usdm";

/** Вход реального зеркала (структурно — MirrorDecision kind "open" из features/demo-mirror). */
export interface LiveOpenDecision {
  tradeId: string;
  kind: "open";
  request: {
    market: Market;
    symbol: string;
    quantity: number;
    stopLoss: number;
    fitMinNotional: boolean;
  };
}

export interface LiveSkipDecision {
  tradeId: string;
  kind: "skip";
  reason: string;
}

/** Объём входа (sizeEntry из features/execute-trade). */
export type LiveEntrySize =
  | { ok: true; quantity: number; notionalUsd: number; raised: boolean }
  | { ok: false; minUsd: number };

export interface LiveGateDeps {
  /** Аварийный стоп: входы остановлены. */
  halted: boolean;
  /** Активные реальные позиции субсчёта (с отправляемыми). */
  openCount: number;
  /** Реализованный PnL экспериментов за текущие сутки UTC, $. */
  dailyPnl: ReadonlyMap<string, number>;
  /** Эксперимент сделки (из кандидатов прогона). */
  experimentOf: (tradeId: string) => string | undefined;
  /** Режим реальных фьючерсов: oneway — входы можно; hedge — пропуск; null — не узнали (ждать). */
  futuresMode: () => Promise<"oneway" | "hedge" | null>;
  /** Объём по правилам символа и цене; null — сеть (ждать). */
  size: (d: LiveOpenDecision) => Promise<LiveEntrySize | null>;
  /** Свободные USDT кошелька рынка; null — не прочитали (ждать). */
  freeUsd: (market: Market) => Promise<number | null>;
  /** Запас на цену покупки спота (LIMIT FOK по цене +0,5% блокирует USDT по лимитной цене). */
  spotSlippage: number;
}

/** Сделка прогона: число позиций и свободные средства уменьшаются с каждым входом (spend). */
export function createLiveGate(deps: LiveGateDeps) {
  let openCount = deps.openCount;
  const free = new Map<Market, Promise<number | null>>();
  const cost = new Map<string, number>();
  const readFree = (market: Market) => {
    let value = free.get(market);
    if (!value) {
      value = deps.freeUsd(market).catch(() => null);
      free.set(market, value);
    }
    return value;
  };
  let mode: Promise<"oneway" | "hedge" | null> | null = null;

  const skip = (d: LiveOpenDecision, reason: string): LiveSkipDecision => ({
    tradeId: d.tradeId,
    kind: "skip",
    reason,
  });

  return {
    async check<D extends LiveOpenDecision>(
      d: D,
    ): Promise<D | LiveSkipDecision | null> {
      if (deps.halted) return skip(d, LIVE_SKIP.halted);
      if (openCount >= LIVE.maxOpenPositions)
        return skip(d, LIVE_SKIP.positions);
      const experimentId = deps.experimentOf(d.tradeId);
      if (!experimentId) return null;
      const pnl = deps.dailyPnl.get(experimentId) ?? 0;
      if (pnl <= -LIVE.dailyLossUsd)
        return skip(
          d,
          `${LIVE_SKIP.daily}: ${usd(pnl)} за сутки — входы до 00:00 UTC`,
        );
      if (d.request.market === "usdm") {
        mode ??= deps.futuresMode().catch(() => null);
        const m = await mode;
        if (m === null) return null;
        if (m !== "oneway") return skip(d, `${LIVE_SKIP.hedge} (Hedge mode)`);
      }
      const size = await deps.size(d).catch(() => null);
      if (!size) return null;
      if (!size.ok)
        return skip(
          d,
          `${LIVE_SKIP.minNotional} ${usd(size.minUsd)} > $${LIVE.maxNotionalUsd}`,
        );
      const need =
        d.request.market === "spot"
          ? size.notionalUsd * (1 + deps.spotSlippage)
          : size.notionalUsd / LIVE.leverage;
      const available = await readFree(d.request.market);
      if (available === null) return null;
      if (available < need)
        return skip(d, `${LIVE_SKIP.funds}: ${usd(available)}`);
      cost.set(d.tradeId, need);
      const sized: D = {
        ...d,
        request: {
          ...d.request,
          quantity: size.quantity,
          // Объём уже посчитан под минимум биржи — ещё раз не поднимаем.
          fitMinNotional: false,
        },
      };
      return sized;
    },
    spend(d: LiveOpenDecision) {
      openCount++;
      const market = d.request.market;
      const spent = cost.get(d.tradeId) ?? 0;
      const value = free.get(market);
      if (value)
        free.set(
          market,
          value.then((v) => (v === null ? null : v - spent)),
        );
    },
  };
}
