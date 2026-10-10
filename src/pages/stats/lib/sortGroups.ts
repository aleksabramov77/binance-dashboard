import type { StatsGroupView } from "@/entities/experiment";
import type { GroupSortKey, SortDir } from "../model/useStatsView";

/** Значение колонки для сортировки; null (нет данных) — всегда в конце. */
function sortValue(g: StatsGroupView, key: GroupSortKey): number | null {
  const s = g.stats;
  switch (key) {
    case "key":
      return null;
    case "trades":
      return s.trades;
    case "winRate":
      return s.winRate;
    case "pnl":
      return s.realizedPnl;
    case "fees":
      return s.fees;
    case "profitFactor":
      // Без убытков, но с прибылью — бесконечный profit factor, лучше любого конечного.
      return (
        s.profitFactor ?? (s.grossProfit > 0 ? Number.POSITIVE_INFINITY : null)
      );
    case "avgR":
      return s.avgR;
    case "maxDrawdown":
      return s.closed ? s.maxDrawdown : null;
  }
}

export function sortGroups(
  groups: StatsGroupView[],
  key: GroupSortKey,
  dir: SortDir,
): StatsGroupView[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => {
    if (key === "key") return sign * a.label.localeCompare(b.label);
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null || vb === null)
      return va === vb ? a.label.localeCompare(b.label) : va === null ? 1 : -1;
    return va === vb
      ? a.label.localeCompare(b.label)
      : sign * (va < vb ? -1 : 1);
  });
}
