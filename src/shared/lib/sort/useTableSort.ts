"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SortDir } from "./sortRows";
import {
  parseSort,
  readSortSnapshot,
  type SavedSort,
  type SortTable,
  saveSort,
  subscribeSort,
} from "./sortStorage";

/** Пропсы SortableHead колонки. */
export interface SortHeadProps {
  active: boolean;
  dir: SortDir;
  onSort: (dir: SortDir) => void;
  onReset: () => void;
}

export interface TableSort<K extends string, S> {
  /** Сохранённая сортировка, иначе порядок по умолчанию. */
  sort: S;
  /** Пропсы SortableHead для колонки. */
  head: (column: K) => SortHeadProps;
}

// На сервере хранилища нет: «ничего не сохранено», после гидрации — сохранённая сортировка.
const nothingSaved = () => null;

/**
 * Сортировка таблицы из меню заголовка — только в localStorage (spec 009), в URL не пишется.
 * Все экземпляры таблицы показывают одну сортировку: читают её из хранилища при рендере и подписаны
 * на изменения — в том числе страницы, которые Next держит скрытыми в `<Activity>`.
 * fallback — порядок по умолчанию, пока ничего не сохранено; его колонка показана активной.
 */
export function useTableSort<K extends string>(
  table: SortTable<K>,
): TableSort<K, SavedSort<K> | null>;
export function useTableSort<K extends string>(
  table: SortTable<K>,
  fallback: SavedSort<K>,
): TableSort<K, SavedSort<K>>;
export function useTableSort<K extends string>(
  table: SortTable<K>,
  fallback: SavedSort<K> | null = null,
): TableSort<K, SavedSort<K> | null> {
  const { name, keys } = table;
  const subscribe = useCallback(
    (onChange: () => void) => subscribeSort(name, onChange),
    [name],
  );
  const snapshot = useCallback(() => readSortSnapshot(name), [name]);
  const raw = useSyncExternalStore(subscribe, snapshot, nothingSaved);
  const saved = useMemo(() => parseSort(raw, keys), [raw, keys]);
  const sort = saved ?? fallback;

  const head = (column: K): SortHeadProps => ({
    active: sort?.key === column,
    dir: sort?.dir ?? "asc",
    onSort: (dir) => saveSort(table, { key: column, dir }),
    onReset: () => saveSort(table, null),
  });

  return { sort, head };
}
