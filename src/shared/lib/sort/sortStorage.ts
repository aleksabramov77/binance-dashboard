import { z } from "zod";
import { SORT_DIRS, type SortDir } from "./sortRows";

// Сортировка таблиц — только в localStorage этого браузера, в URL не пишется (решение пользователя
// 2026-10-15, spec 009). Имя таблицы заводит её слайс через defineSortTable: shared имён не знает,
// их уникальность во всём src проверяет sortTables.test.ts.
// localStorage недоступен (приватный режим, запрет) — сортировка живёт в памяти до перезагрузки.

const PREFIX = "binance-dashboard:sort:";

/**
 * Имя таблицы: `<маршрут>:<таблица>`. Маршрут — шаблон пути без конкретного id (`items/[id]`),
 * поэтому у таблицы одна сортировка на все страницы маршрута.
 */
export type SortTableName = `${string}:${string}`;

export interface SortTable<K extends string> {
  name: SortTableName;
  /** Колонки с сортировкой: устаревшая или чужая колонка в хранилище не применяется. */
  keys: readonly K[];
}

export interface SavedSort<K extends string> {
  key: K;
  dir: SortDir;
}

/** Таблица с сортировкой. Имя — строковым литералом: по нему тест ищет повторы. */
export function defineSortTable<K extends string>(
  name: SortTableName,
  keys: readonly K[],
): SortTable<K> {
  return { name, keys };
}

const savedSchema = z.object({ key: z.string(), dir: z.enum(SORT_DIRS) });

// Значения, которые не удалось записать в localStorage (null — сброс): главнее него до перезагрузки.
const memory = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

/** Сохранённая сортировка как есть — строка или null, снимок для useSyncExternalStore. */
export function readSortSnapshot(name: SortTableName): string | null {
  const key = PREFIX + name;
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Разбор снимка; мусор, неизвестная колонка или направление — нет сортировки. */
export function parseSort<K extends string>(
  raw: string | null,
  keys: readonly K[],
): SavedSort<K> | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = savedSchema.safeParse(json);
  if (!parsed.success) return null;
  const key = keys.find((k) => k === parsed.data.key);
  return key ? { key, dir: parsed.data.dir } : null;
}

/** null — сортировка сброшена. Все экземпляры таблицы узнают об изменении сразу. */
export function saveSort<K extends string>(
  table: SortTable<K>,
  value: SavedSort<K> | null,
): void {
  const key = PREFIX + table.name;
  const raw = value && JSON.stringify({ key: value.key, dir: value.dir });
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
    memory.delete(key);
  } catch {
    memory.set(key, raw);
  }
  for (const notify of listeners.get(key) ?? []) notify();
}

/** Подписка на сортировку таблицы: изменения из этой вкладки и из других (событие storage). */
export function subscribeSort(
  name: SortTableName,
  onChange: () => void,
): () => void {
  const key = PREFIX + name;
  let own = listeners.get(key);
  if (!own) {
    own = new Set();
    listeners.set(key, own);
  }
  own.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    own.delete(onChange);
    if (own.size === 0) listeners.delete(key);
    window.removeEventListener("storage", onStorage);
  };
}
