"use client";

import { useQuery } from "@tanstack/react-query";
import { type EarnSummary, earnSummarySchema } from "../model/schema";

export const earnSummaryQueryKey = ["earn-summary"] as const;

async function getEarnSummary(): Promise<EarnSummary> {
  const res = await fetch("/api/earn/summary", { cache: "no-store" });
  if (!res.ok) throw new Error(`Сводка Binance недоступна (${res.status})`);
  return earnSummarySchema.parse(await res.json());
}

/** Публичная сводка ставок по видам (без ключа): работает и в облаке. */
export function useEarnSummary() {
  return useQuery({
    queryKey: earnSummaryQueryKey,
    queryFn: getEarnSummary,
    staleTime: 10 * 60_000,
  });
}
