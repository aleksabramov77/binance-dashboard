"use client";

import { useQuery } from "@tanstack/react-query";
import { type LogFilters, logFiltersSearch } from "../model/filters";
import { logsResponseSchema } from "../model/schema";

async function getLogs(filters: LogFilters) {
  const qs = new URLSearchParams(logFiltersSearch(filters));
  qs.set("limit", "300");
  const res = await fetch(`/api/logs?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Журнал не загрузился (${res.status})`);
  return logsResponseSchema.parse(await res.json()).entries;
}

/** Журнал сервера с фильтрами (spec 0016); обновляется каждые 10 секунд. */
export function useLogs(filters: LogFilters) {
  return useQuery({
    queryKey: ["logs", filters],
    queryFn: () => getLogs(filters),
    refetchInterval: 10_000,
  });
}
