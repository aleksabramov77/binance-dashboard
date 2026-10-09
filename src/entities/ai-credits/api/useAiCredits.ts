"use client";

import { useQuery } from "@tanstack/react-query";
import { aiCreditsSchema } from "../model/schema";

export const aiCreditsQueryKey = ["ai-credits"] as const;

async function getAiCredits() {
  const res = await fetch("/api/openrouter/balance", { cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Баланс OpenRouter недоступен (${res.status})`);
  }
  return aiCreditsSchema.parse(body);
}

/** Баланс OpenRouter; обновляется раз в 5 минут и после каждого разбора. */
export function useAiCredits() {
  return useQuery({
    queryKey: aiCreditsQueryKey,
    queryFn: getAiCredits,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
}
