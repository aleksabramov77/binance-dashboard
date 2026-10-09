"use client";

import { useQuery } from "@tanstack/react-query";
import { type TradeOverview, tradeOverviewSchema } from "../model/schema";

export const tradeOverviewQueryKey = ["trade-overview"] as const;

async function getTradeOverview(): Promise<TradeOverview> {
  const res = await fetch("/api/trade", { cache: "no-store" });
  return tradeOverviewSchema.parse(await res.json());
}

export function useTradeOverview() {
  return useQuery({
    queryKey: tradeOverviewQueryKey,
    queryFn: getTradeOverview,
  });
}
