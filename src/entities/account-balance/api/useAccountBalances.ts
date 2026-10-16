"use client";

import { useQuery } from "@tanstack/react-query";
import { accountBalancesSchema } from "../model/schema";

export const accountBalancesQueryKey = ["accounts", "balances"] as const;

async function getAccountBalances() {
  const res = await fetch("/api/accounts/balances", { cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Остатки счетов недоступны (${res.status})`);
  }
  return accountBalancesSchema.parse(body);
}

/**
 * Остатки Demo и Real по группам для шапки: опрос раз в 30 с, а сервер кэширует ответ бирж на 60 с —
 * к каждому хосту Binance не больше запроса в минуту (spec 0038, AC5).
 */
export function useAccountBalances() {
  return useQuery({
    queryKey: accountBalancesQueryKey,
    queryFn: getAccountBalances,
    refetchInterval: 30_000,
    retry: 1,
  });
}
