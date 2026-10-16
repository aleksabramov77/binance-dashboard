"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  experimentDetailResponseSchema,
  experimentsResponseSchema,
  type RunParam,
} from "../model/view";

/** Сделки по умолчанию на детальной странице. */
export const EXPERIMENT_TRADES_LIMIT = 200;
/** Тик движка — раз в минуту; чаще обновлять нет смысла. */
const REFETCH_MS = 30_000;

/** Общий префикс ключей лаборатории: инвалидация после сбросов и тумблеров. */
export const experimentsQueryKey = ["experiments"] as const;
/** Список за период (spec 0046): null — текущая эпоха. */
export const experimentsListQueryKey = (run: RunParam | null = null) =>
  [...experimentsQueryKey, "list", run] as const;
export const experimentQueryKey = (id: string, run: RunParam | null = null) =>
  [...experimentsQueryKey, "detail", id, run] as const;

const runQuery = (run: RunParam | null) =>
  run === null ? "" : `run=${encodeURIComponent(String(run))}`;

async function getExperiments(run: RunParam | null) {
  const query = runQuery(run);
  const res = await fetch(`/api/experiments${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Эксперименты не загрузились (${res.status})`);
  return experimentsResponseSchema.parse(await res.json());
}

async function getExperiment(id: string, run: RunParam | null) {
  const query = runQuery(run);
  const res = await fetch(
    `/api/experiments/${encodeURIComponent(id)}?limit=${EXPERIMENT_TRADES_LIMIT}${query ? `&${query}` : ""}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Эксперимент не загрузился (${res.status})`);
  return experimentDetailResponseSchema.parse(await res.json());
}

/** Эксперименты со статистикой периода: null — текущая эпоха, номер — прошлая, all — все эпохи. */
export function useExperiments(run: RunParam | null = null) {
  return useQuery({
    queryKey: experimentsListQueryKey(run),
    queryFn: () => getExperiments(run),
    refetchInterval: REFETCH_MS,
    placeholderData: keepPreviousData,
  });
}

/** Эксперимент со статистикой, equity-кривой и сделками периода; null — нет такого id. */
export function useExperiment(id: string, run: RunParam | null = null) {
  return useQuery({
    queryKey: experimentQueryKey(id, run),
    queryFn: () => getExperiment(id, run),
    refetchInterval: REFETCH_MS,
  });
}
