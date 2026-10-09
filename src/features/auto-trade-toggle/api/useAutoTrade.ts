"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AutoTradeState,
  autoTradeStateSchema,
  tradeHistoryQueryKey,
  tradeOverviewQueryKey,
} from "@/entities/trade";

const autoTradeQueryKey = ["auto-trade"] as const;

async function readJson(res: Response): Promise<AutoTradeState> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Автоторговля не ответила (${res.status})`);
  }
  return autoTradeStateSchema.parse(body);
}

export function useAutoTrade() {
  return useQuery({
    queryKey: autoTradeQueryKey,
    queryFn: () =>
      fetch("/api/auto-trade", { cache: "no-store" }).then(readJson),
    refetchInterval: 30_000,
  });
}

export function useToggleAutoTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      fetch("/api/auto-trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then(readJson),
    onSuccess: (state) => {
      queryClient.setQueryData(autoTradeQueryKey, state);
      // Первый цикл идёт сразу — через полминуты подтянем результат и сделки.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: autoTradeQueryKey });
        void queryClient.invalidateQueries({ queryKey: tradeOverviewQueryKey });
        void queryClient.invalidateQueries({ queryKey: tradeHistoryQueryKey });
      }, 30_000);
    },
  });
}
