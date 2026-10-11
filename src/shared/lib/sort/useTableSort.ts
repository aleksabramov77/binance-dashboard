"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { SORT_DIRS, type SortDir } from "./sortRows";

/**
 * Сортировка таблицы по клику на заголовок — в URL: `?<param>=<колонка>&<param>Dir=asc|desc`.
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

  /** Пропсы для SortableHead: повторный клик меняет направление, новая колонка — с firstDir. */
  const head = (column: K, firstDir: SortDir = "asc") => {
    const active = key === column;
    return {
      active,
      dir,
      onSort: () => {
        const next: SortDir = active
          ? dir === "asc"
            ? "desc"
            : "asc"
          : firstDir;
        void setKey(column);
        void setDir(next === "asc" ? null : next);
      },
    };
  };

  return { sort, head };
}
