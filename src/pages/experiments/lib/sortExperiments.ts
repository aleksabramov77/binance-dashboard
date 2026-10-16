import {
  ASSET_GROUPS,
  controlOf,
  type ExperimentSummary,
  variantLetters,
} from "@/entities/experiment";
import type { SortDir } from "@/shared/lib";
import type { MarketFilter } from "../model/useExperimentsView";

export const SORT_KEYS = [
  "enabled",
  "id",
  "ag",
  "trades",
  "winRate",
  "pnl",
  "profitFactor",
  "maxDrawdown",
  "equity",
  "live",
  "demo",
  "demoTrades",
  "demoWinRate",
  "demoPnl",
  "demoProfitFactor",
  "demoMaxDrawdown",
  "demoEquity",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

/** Порядок групп активов для сортировки по AG: как в карте ASSET_GROUPS (Spot, USDⓈ-M, COIN-M). */
const AG_ORDER = Object.keys(ASSET_GROUPS);

/** Значение колонки для сортировки; null (нет данных) — всегда в конце. */
function sortValue(e: ExperimentSummary, key: SortKey): number | null {
  const s = e.stats;
  switch (key) {
    case "enabled":
      return e.enabled ? 1 : 0;
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
    case "live":
      // Сначала торгующие на реальном счёте, потом ждущие «Авто».
      return e.liveMirror ? 2 : e.liveMirrorMode === "off" ? 0 : 1;
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

/** Строка таблицы /experiments: эксперимент и его место в группе «контрольный + варианты» (spec 0046). */
export interface ExperimentRowView {
  e: ExperimentSummary;
  /** Контрольный, под которым стоит строка; null — строка верхнего уровня. */
  variantOf: string | null;
  /** Буква варианта (по порядку id среди вариантов контрольного во всём списке). */
  letter: string | null;
  /** Сколько вариантов показано под строкой (для шеврона контрольного). */
  variants: number;
}

/**
 * Группы вариантов поверх отсортированного списка (spec 0046, AC8): группы идут в порядке строки контрольного,
 * варианты стоят сразу под ним в том же порядке сортировки. Вариант, контрольного которого нет в списке (фильтр AG,
 * контрольный не в БД), — обычной строкой на своём месте. all — все эксперименты (буквы и связи — по нему).
 */
export function arrangeVariants(
  sorted: readonly ExperimentSummary[],
  all: readonly ExperimentSummary[],
): ExperimentRowView[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const letters = variantLetters(all);
  const shown = new Set(sorted.map((e) => e.id));
  const children = new Map<string, ExperimentSummary[]>();
  const nested = new Set<string>();
  for (const e of sorted) {
    const control = controlOf(e, byId);
    if (!control || !shown.has(control.id)) continue;
    nested.add(e.id);
    const list = children.get(control.id);
    if (list) list.push(e);
    else children.set(control.id, [e]);
  }
  return sorted.flatMap((e) => {
    if (nested.has(e.id)) return [];
    const variants = children.get(e.id) ?? [];
    return [
      { e, variantOf: null, letter: null, variants: variants.length },
      ...variants.map((v) => ({
        e: v,
        variantOf: e.id,
        letter: letters.get(v.id) ?? null,
        variants: 0,
      })),
    ];
  });
}
