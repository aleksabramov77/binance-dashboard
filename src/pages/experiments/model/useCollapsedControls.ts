"use client";

import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

// Свёрнутые группы вариантов /experiments (spec 0046, AC8): id контрольных — в localStorage этого браузера,
// по умолчанию всё развёрнуто. localStorage недоступен — состояние живёт в памяти до перезагрузки.

const KEY = "binance-dashboard:experiments:collapsed";
const listeners = new Set<() => void>();
let memory: string | null | undefined;

const idsSchema = z.array(z.string());

function read(): string | null {
  if (memory !== undefined) return memory;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed = idsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  const raw = JSON.stringify(ids);
  try {
    window.localStorage.setItem(KEY, raw);
    memory = undefined;
  } catch {
    memory = raw;
  }
  for (const l of listeners) l();
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/** Свёрнутые контрольные и переключатель: свёрнут — варианты под ним скрыты. */
export function useCollapsedControls() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const collapsed = new Set(parse(raw));
  const toggle = useCallback((id: string) => {
    const ids = new Set(parse(read()));
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    write([...ids]);
  }, []);
  return { collapsed, toggle };
}
