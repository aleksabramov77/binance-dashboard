"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { SORT_DIRS, type SortDir } from "./sortRows";
import { saveSort, useRestoreSort } from "./sortStorage";

/**
 * Сортировка таблицы из меню заголовка — в URL: `?<param>=<колонка>&<param>Dir=desc`.
 * Без параметра — исходный порядок данных (`sort` = null). Последний выбор запоминается в
 * localStorage и восстанавливается, если в URL сортировки нет.
 * Разные таблицы одной страницы используют разные `param`.
 */
export function useTableSort<K extends string>(
  param: string,
  keys: readonly K[],
) {
  const [key, setKey] = useQueryState(param, parseAsStringLiteral(keys));
  const [dir, setDir] = useQueryState(
    `${param}Dir`,
    parseAsStringLiteral(SORT_DIRS).withDefault("asc"),
  );
  const sort = key === null ? null : { key, dir };

  const apply = (column: K | null, next: SortDir) => {
    void setKey(column);
    void setDir(column === null || next === "asc" ? null : next);
  };
  useRestoreSort(param, keys, key !== null, (saved) =>
    apply(saved.key, saved.dir),
  );

  /** Пропсы для SortableHead колонки. */
  const head = (column: K) => ({
    active: key === column,
    dir,
    onSort: (next: SortDir) => {
      apply(column, next);
      saveSort(param, { key: column, dir: next });
    },
    onReset: () => {
      apply(null, "asc");
      saveSort(param, null);
    },
  });

  return { sort, head };
}
