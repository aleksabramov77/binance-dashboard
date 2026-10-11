"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { SORT_DIRS, type SortDir } from "./sortRows";

/**
 * Сортировка таблицы из меню заголовка — в URL: `?<param>=<колонка>&<param>Dir=desc`.
 * Без параметра — исходный порядок данных (`sort` = null).
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

  /** Пропсы для SortableHead колонки. */
  const head = (column: K) => ({
    active: key === column,
    dir,
    onSort: (next: SortDir) => {
      void setKey(column);
      void setDir(next === "asc" ? null : next);
    },
    onReset: () => {
      void setKey(null);
      void setDir(null);
    },
  });

  return { sort, head };
}
