"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type TradeRequest,
  type TradeResult,
  tradeOverviewQueryKey,
  tradeResultSchema,
} from "@/entities/trade";

async function postTrade(req: TradeRequest): Promise<TradeResult> {
  const res = await fetch("/api/trade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Сделка не отправлена (${res.status})`);
  }
  return tradeResultSchema.parse(body);
}

export function usePlaceTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postTrade,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tradeOverviewQueryKey }),
  });
}
