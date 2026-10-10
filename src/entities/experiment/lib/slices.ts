import type {
  ExperimentMarket,
  PaperTrade,
  TradeDirection,
} from "@binance-dashboard/trading-core";
import type { StatsGroupBy, StatsPeriod } from "../model/statsView";
import { groupStats, type StatsGroup, type StatsTrade } from "./stats";

// Разрезы /stats (spec 003, задача 3c): фильтры сделок, группировка с бюджетами, лучшие/худшие
// группы и кандидаты в blacklist. Чистые функции — сервер считает, страница только показывает.

/** Сделка с полями, по которым режут: подходит PaperTrade. */
export type SliceTrade = StatsTrade &
  Pick<PaperTrade, "experimentId" | "market" | "symbol" | "direction">;

export interface SliceFilters {
  market?: ExperimentMarket;
  experiment?: string;
  direction?: TradeDirection;
  symbol?: string;
  /** Начало периода, мс; null/undefined — вся эпоха. */
  since?: number | null;
}

/** Эксперимент для бюджетов групп. */
export interface SliceExperiment {
  id: string;
  market: ExperimentMarket;
  initialBudget: number;
}

const HOUR = 3_600_000;
const PERIOD_MS: Record<Exclude<StatsPeriod, "epoch">, number> = {
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
};

/** Начало периода, мс; null — с начала эпохи. */
export const periodStart = (period: StatsPeriod, now: number): number | null =>
  period === "epoch" ? null : now - PERIOD_MS[period];

/**
 * Сделки под фильтры. Период: закрытая сделка попадает по времени закрытия (тогда реализован PnL),
 * открытая — по времени открытия.
 */
export function filterTrades<T extends SliceTrade>(
  trades: T[],
  f: SliceFilters,
): T[] {
  const since = f.since ?? null;
  return trades.filter(
    (t) =>
      (f.market === undefined || t.market === f.market) &&
      (f.experiment === undefined || t.experimentId === f.experiment) &&
      (f.direction === undefined || t.direction === f.direction) &&
      (f.symbol === undefined || t.symbol === f.symbol) &&
      (since === null || Date.parse(t.closedAt ?? t.openedAt) >= since),
  );
}

const KEY_OF: Record<StatsGroupBy, (t: SliceTrade) => string> = {
  experiment: (t) => t.experimentId,
  market: (t) => t.market,
  symbol: (t) => t.symbol,
  direction: (t) => t.direction,
};

/**
 * Группы разреза. Стартовый капитал группы: эксперимент — его бюджет, рынок — сумма бюджетов
 * переданных экспериментов этого рынка; монета и направление — 0 (общего капитала у них нет,
 * просадка — в USD). Группы — по убыванию PnL.
 */
export function sliceStats<T extends SliceTrade>(
  trades: T[],
  groupBy: StatsGroupBy,
  experiments: SliceExperiment[],
): StatsGroup<string>[] {
  const budgetOf = (key: string): number => {
    if (groupBy === "experiment")
      return experiments.find((e) => e.id === key)?.initialBudget ?? 0;
    if (groupBy === "market")
      return experiments
        .filter((e) => e.market === key)
        .reduce((sum, e) => sum + e.initialBudget, 0);
    return 0;
  };
  return groupStats(trades, KEY_OF[groupBy], budgetOf);
}

/** Лучшие n групп с прибылью и худшие n с убытком (только с закрытыми сделками). */
export function rankGroups<G extends StatsGroup<string>>(
  groups: G[],
  n = 3,
): { best: G[]; worst: G[] } {
  const closed = groups
    .filter((g) => g.stats.closed > 0)
    .sort((a, b) => b.stats.realizedPnl - a.stats.realizedPnl);
  return {
    best: closed.filter((g) => g.stats.realizedPnl > 0).slice(0, n),
    worst: closed
      .filter((g) => g.stats.realizedPnl < 0)
      .reverse()
      .slice(0, n),
  };
}

/** Кандидаты в blacklist: до n монет с наибольшим реализованным убытком. */
export function blacklistCandidates(
  groups: StatsGroup<string>[],
  n = 5,
): Set<string> {
  return new Set(rankGroups(groups, n).worst.map((g) => g.key));
}
