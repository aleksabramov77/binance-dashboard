"use client";

import { useQuery } from "@tanstack/react-query";
import { type EngineStatus, engineStatusSchema } from "../model/engine";

export const engineStatusQueryKey = ["experiments", "engine"] as const;

export async function readEngineStatus(res: Response): Promise<EngineStatus> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Движок лаборатории не ответил (${res.status})`);
  }
  return engineStatusSchema.parse(body);
}

/** Статус движка лаборатории (тумблер «Автоторговля», последний тик). */
export function useEngineStatus() {
  return useQuery({
    queryKey: engineStatusQueryKey,
    queryFn: () =>
      fetch("/api/experiments/engine", { cache: "no-store" }).then(
        readEngineStatus,
      ),
    refetchInterval: 60_000,
    retry: 1,
  });
}
