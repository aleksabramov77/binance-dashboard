"use client";

import { useQuery } from "@tanstack/react-query";
import { experimentBudgetsSchema } from "../model/budget";

export const experimentBudgetsQueryKey = ["experiments", "budgets"] as const;

async function getExperimentBudgets() {
  const res = await fetch("/api/experiments/budgets", { cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Бюджеты лаборатории недоступны (${res.status})`);
  }
  return experimentBudgetsSchema.parse(body);
}

/** Бюджеты групп Spot, USDⓈ-M и COIN-M текущей эпохи; движок тикает раз в минуту — обновляем раз в 30 с. */
export function useExperimentBudgets() {
  return useQuery({
    queryKey: experimentBudgetsQueryKey,
    queryFn: getExperimentBudgets,
    refetchInterval: 30_000,
    retry: 1,
  });
}
