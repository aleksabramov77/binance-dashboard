import { ASSET_GROUPS, type ExperimentSummary } from "@/entities/experiment";
import type { SortDir } from "@/shared/lib";
import type { MarketFilter } from "../model/useExperimentsView";

export const SORT_KEYS = [
  "id",
  "ag",
  "trades",
  "winRate",
  "pnl",
  "profitFactor",
  "maxDrawdown",
  "equity",
  "demo",
  "demoTrades",
  "demoWinRate",
  "demoPnl",
  "demoProfitFactor",
  "demoMaxDrawdown",
  "demoEquity",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

/** Порядок групп активов для сортировки по AG: как в карте ASSET_GROUPS (Spot, USDⓈ-M). */
const AG_ORDER = Object.keys(ASSET_GROUPS);

/** Значение колонки для сортировки; null (нет данных) — всегда в конце. */
function sortValue(e: ExperimentSummary, key: SortKey): number | null {
  const s = e.stats;
  switch (key) {
    case "id":
      return null;
    case "ag":
      return AG_ORDER.indexOf(e.market);
    case "trades":
      return s.trades;
    case "winRate":
      return s.winRate;
    case "pnl":
      return s.realizedPnl;
    case "profitFactor":
      // Без убытков, но с прибылью — бесконечный profit factor, лучше любого конечного.
      return (
        s.profitFactor ?? (s.grossProfit > 0 ? Number.POSITIVE_INFINITY : null)
      );
    case "maxDrawdown":
      return s.closed ? s.maxDrawdownPct : null;
    case "equity":
      return s.equity;
    case "demo":
      // Сначала торгующие на демо, среди них — по числу демо-сделок.
      return (e.demoMirror ? 1e6 : 0) + e.demo.trades;
    case "demoTrades":
      return e.demo.trades || null;
    case "demoWinRate":
      return e.demo.closed ? e.demo.wins / e.demo.closed : null;
    case "demoPnl":
      return e.demo.closed ? e.demo.pnl : null;
    case "demoProfitFactor":
      return e.demo.closed
        ? (e.demo.profitFactor ??
            (e.demo.grossProfit > 0 ? Number.POSITIVE_INFINITY : null))
        : null;
    case "demoMaxDrawdown":
      return e.demo.closed ? e.demo.maxDrawdownPct : null;
    case "demoEquity":
      return e.demo.closed ? e.demo.equity : null;
  }
}

export function sortExperiments(
  list: ExperimentSummary[],
  market: MarketFilter,
  key: SortKey,
  dir: SortDir,
): ExperimentSummary[] {
  const sign = dir === "asc" ? 1 : -1;
  return list
    .filter((e) => market === "all" || e.market === market)
    .sort((a, b) => {
      if (key === "id") return sign * a.id.localeCompare(b.id);
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va === null || vb === null)
        return va === vb ? a.id.localeCompare(b.id) : va === null ? 1 : -1;
      return va === vb ? a.id.localeCompare(b.id) : sign * (va < vb ? -1 : 1);
    });
}
