"use client";

import { useEffect, useRef } from "react";
import { SORT_DIRS, type SortDir } from "./sortRows";

// Последняя сортировка таблицы — в localStorage этого браузера (по просьбе пользователя 2026-10-11:
// «чтобы не слетало»). URL главнее: ссылка с ?sort=… показывает свою сортировку.
// Хранилище может быть недоступно (приватный режим, запрет cookies) — тогда просто не запоминаем.

const PREFIX = "binance-dashboard:sort:";

export interface SavedSort<K extends string> {
  key: K;
  dir: SortDir;
}

export function loadSort<K extends string>(
  name: string,
  keys: readonly K[],
): SavedSort<K> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const value = JSON.parse(raw) as { key?: unknown; dir?: unknown };
    const key = keys.find((k) => k === value.key);
    const dir = SORT_DIRS.find((d) => d === value.dir);
    return key && dir ? { key, dir } : null;
  } catch {
    return null;
  }
}

/** null — сортировка сброшена: забываем сохранённую. */
export function saveSort(name: string, value: SavedSort<string> | null): void {
  try {
    if (value)
      window.localStorage.setItem(PREFIX + name, JSON.stringify(value));
    else window.localStorage.removeItem(PREFIX + name);
  } catch {
    // Хранилище недоступно — сортировка живёт только в URL.
  }
}

/**
 * Один раз после монтирования: если в URL сортировки нет — применить сохранённую.
 * apply вызывается вне рендера (в эффекте), поэтому может менять URL.
 */
export function useRestoreSort<K extends string>(
  name: string,
  keys: readonly K[],
  inUrl: boolean,
  apply: (saved: SavedSort<K>) => void,
): void {
  const done = useRef(false);
  const latest = useRef({ keys, inUrl, apply });
  latest.current = { keys, inUrl, apply };
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const { keys: k, inUrl: present, apply: run } = latest.current;
    if (present) return;
    const saved = loadSort(name, k);
    if (saved) run(saved);
  }, [name]);
}
