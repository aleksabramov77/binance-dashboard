"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type StatsQueryInput,
  tradeStatsResponseSchema,
} from "../model/statsView";
import { experimentsQueryKey } from "./useExperiments";

const REFETCH_MS = 30_000;

export const tradeStatsQueryKey = (query: StatsQueryInput) =>
  [...experimentsQueryKey, "stats", query] as const;

async function getTradeStats(query: StatsQueryInput) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const res = await fetch(`/api/experiments/stats?${params}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Разрезы не загрузились (${res.status})`);
  return tradeStatsResponseSchema.parse(await res.json());
}

/** Разрезы /stats по фильтрам; null — нет такой эпохи. Пока грузится новый разрез, виден прежний. */
export function useTradeStats(query: StatsQueryInput) {
  return useQuery({
    queryKey: tradeStatsQueryKey(query),
    queryFn: () => getTradeStats(query),
    refetchInterval: REFETCH_MS,
    placeholderData: keepPreviousData,
  });
}
