export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

/** Значение ячейки для сортировки; null/undefined (нет данных) — всегда в конце. */
export type SortValue = number | string | boolean | null | undefined;

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "string" && typeof b === "string")
    return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" });
  const na = Number(a);
  const nb = Number(b);
  return na === nb ? 0 : na < nb ? -1 : 1;
}

/**
 * Устойчивая сортировка строк таблицы по значению колонки.
 * Пустые значения — в конце при любом направлении; при равенстве — исходный порядок.
 */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => SortValue,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const aEmpty = a.v === null || a.v === undefined || Number.isNaN(a.v);
      const bEmpty = b.v === null || b.v === undefined || Number.isNaN(b.v);
      if (aEmpty || bEmpty)
        return aEmpty === bEmpty ? a.index - b.index : aEmpty ? 1 : -1;
      return sign * compareValues(a.v, b.v) || a.index - b.index;
    })
    .map(({ row }) => row);
}
