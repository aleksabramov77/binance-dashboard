"use client";

import { useQuery } from "@tanstack/react-query";
import { type TradeHistory, tradeHistorySchema } from "../model/schema";

export const tradeHistoryQueryKey = ["trade-history"] as const;

async function getTradeHistory(): Promise<TradeHistory> {
  const res = await fetch("/api/trade/history", { cache: "no-store" });
  if (!res.ok) throw new Error(`История сделок не загрузилась (${res.status})`);
  return tradeHistorySchema.parse(await res.json());
}

export function useTradeHistory() {
  return useQuery({
    queryKey: tradeHistoryQueryKey,
    queryFn: getTradeHistory,
  });
}
