"use client";

import { useQuery } from "@tanstack/react-query";
import { appVersionSchema, getPageVersion, isStaleVersion } from "@/shared/lib";

export const serverVersionQueryKey = ["app-version"] as const;

/** Сравнение — в запросе, а не в рендере: версию страницы Next хранит вне React, перерисовку она не вызывает. */
async function checkNewVersion(): Promise<boolean> {
  const res = await fetch("/api/version", { cache: "no-store" });
  if (!res.ok) throw new Error(`Версия сервера недоступна (${res.status})`);
  const { version } = appVersionSchema.parse(await res.json());
  return isStaleVersion(getPageVersion(), version);
}

/**
 * Вышла ли новая сборка, пока вкладка открыта: раз в 5 минут и при возврате на вкладку.
 * Версия страницы не задана (локально, dev) — не опрашивает и всегда false.
 */
export function useNewVersionAvailable(): boolean {
  const { data } = useQuery({
    queryKey: serverVersionQueryKey,
    queryFn: checkNewVersion,
    enabled: getPageVersion() !== null,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: "always",
    retry: 1,
  });
  return data === true;
}
