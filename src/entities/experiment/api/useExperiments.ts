"use client";

import { useQuery } from "@tanstack/react-query";
import {
  experimentDetailResponseSchema,
  experimentsResponseSchema,
} from "../model/view";

/** Сделки по умолчанию на детальной странице. */
export const EXPERIMENT_TRADES_LIMIT = 200;
/** Тик движка — раз в минуту; чаще обновлять нет смысла. */
const REFETCH_MS = 30_000;

export const experimentsQueryKey = ["experiments"] as const;
export const experimentQueryKey = (id: string) =>
  [...experimentsQueryKey, id] as const;

async function getExperiments() {
  const res = await fetch("/api/experiments", { cache: "no-store" });
  if (!res.ok) throw new Error(`Эксперименты не загрузились (${res.status})`);
  return experimentsResponseSchema.parse(await res.json());
}

async function getExperiment(id: string) {
  const res = await fetch(
    `/api/experiments/${encodeURIComponent(id)}?limit=${EXPERIMENT_TRADES_LIMIT}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Эксперимент не загрузился (${res.status})`);
  return experimentDetailResponseSchema.parse(await res.json());
}

/** 40 экспериментов со статистикой текущей эпохи. */
export function useExperiments() {
  return useQuery({
    queryKey: experimentsQueryKey,
    queryFn: getExperiments,
    refetchInterval: REFETCH_MS,
  });
}

/** Эксперимент со статистикой, equity-кривой и сделками; null — нет такого id. */
export function useExperiment(id: string) {
  return useQuery({
    queryKey: experimentQueryKey(id),
    queryFn: () => getExperiment(id),
    refetchInterval: REFETCH_MS,
  });
}
