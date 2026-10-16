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
      // Без закрытых сделок в ячейке «—», а не 0 $: такие строки — в конце, а не между плюсом и минусом.
      return s.closed ? s.realizedPnl : null;
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
      // Сначала торгующие на реальном счёте.
      return e.liveMirror ? 1 : 0;
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

/**
 * Группы «контрольный + варианты» — только при сортировке по колонке «Эксперимент» (по умолчанию тоже она).
 * Любая другая колонка главнее групп: каждая строка — на месте по её значению (spec 0052).
 */
export function isGroupedSort(key: SortKey): boolean {
  return key === "id";
}

/** Строка таблицы /experiments: эксперимент и его место в группе «контрольный + варианты» (spec 0046, 0052). */
export interface ExperimentRowView {
  e: ExperimentSummary;
  /** Контрольный варианта (есть среди всех экспериментов); null — не вариант или контрольного нет в БД. */
  variantOf: string | null;
  /** Буква варианта (по порядку id среди вариантов контрольного во всём списке). */
  letter: string | null;
  /**
   * Стоит под своим контрольным (групповой вид, контрольный в списке): отступ и «↳». Вариант не под контрольным —
   * плоский вид или контрольный скрыт фильтром AG — обычная строка с меткой «вариант X от …».
   */
  nested: boolean;
  /** Сколько вариантов показано под строкой (для шеврона контрольного); в плоском виде — 0. */
  variants: number;
}

/**
 * Раскладка отсортированного списка. Групповой вид (spec 0046, AC8): группы идут в порядке строки контрольного,
 * варианты стоят сразу под ним в том же порядке сортировки; вариант, контрольного которого нет в списке (фильтр AG,
 * контрольный не в БД), — обычной строкой на своём месте. Плоский вид (spec 0052): строки — ровно в порядке sorted,
 * у варианта есть контрольный и буква, но он не вложен. all — все эксперименты (буквы и связи — по нему).
 */
export function arrangeVariants(
  sorted: readonly ExperimentSummary[],
  all: readonly ExperimentSummary[],
  grouped: boolean,
): ExperimentRowView[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const letters = variantLetters(all);
  const row = (
    e: ExperimentSummary,
    nested: boolean,
    variants: number,
  ): ExperimentRowView => ({
    e,
    variantOf: controlOf(e, byId)?.id ?? null,
    letter: letters.get(e.id) ?? null,
    nested,
    variants,
  });
  if (!grouped) return sorted.map((e) => row(e, false, 0));

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
      row(e, false, variants.length),
      ...variants.map((v) => row(v, true, 0)),
    ];
  });
}

/**
 * Без вариантов свёрнутых контрольных (шеврон, spec 0046). Прячутся только строки, вложенные под контрольный, поэтому
 * в плоском виде видно всё, а сохранённая свёрнутость снова действует в групповом (spec 0052, AC4).
 */
export function hideCollapsed(
  rows: readonly ExperimentRowView[],
  collapsed: ReadonlySet<string>,
): ExperimentRowView[] {
  return rows.filter(
    (r) => !r.nested || r.variantOf === null || !collapsed.has(r.variantOf),
  );
}
