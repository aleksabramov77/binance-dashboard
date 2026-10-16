"use client";

import { useQuery } from "@tanstack/react-query";
import { liveStatusResponseSchema } from "../model/heartbeat";

export const liveAccountQueryKey = ["live", "status"] as const;

async function getLiveStatus() {
  const res = await fetch("/api/live/status", { cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(
      error ?? `Состояние реального счёта недоступно (${res.status})`,
    );
  }
  return liveStatusResponseSchema.parse(body);
}

/** Последний пульс воркера реального счёта для карточки /settings: опрос раз в 30 с (пульс — раз в минуту). */
export function useLiveAccount() {
  return useQuery({
    queryKey: liveAccountQueryKey,
    queryFn: getLiveStatus,
    refetchInterval: 30_000,
    retry: 1,
  });
}
