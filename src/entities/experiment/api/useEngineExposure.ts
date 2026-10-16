"use client";

import { useQuery } from "@tanstack/react-query";
import { type EngineExposure, engineExposureSchema } from "../model/exposure";

export const engineExposureQueryKey = [
  "experiments",
  "engine",
  "exposure",
] as const;

async function fetchEngineExposure(): Promise<EngineExposure> {
  const res = await fetch("/api/experiments/engine/exposure", {
    cache: "no-store",
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Не удалось посчитать сделки (${res.status})`);
  }
  return engineExposureSchema.parse(body);
}

/**
 * Открытые paper-сделки и демо-позиции — для модалки выключения «Автоторговли» (spec 0044).
 * Числа каждый раз свежие: кэш не хранится (gcTime 0), хук монтируется вместе с модалкой.
 */
export function useEngineExposure() {
  return useQuery({
    queryKey: engineExposureQueryKey,
    queryFn: fetchEngineExposure,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
