"use client";

import { useQuery } from "@tanstack/react-query";
import { type Portfolio, portfolioSchema } from "../model/schema";

export const portfolioQueryKey = ["portfolio"] as const;

async function getPortfolio(): Promise<Portfolio> {
  const res = await fetch("/api/portfolio", { cache: "no-store" });
  return portfolioSchema.parse(await res.json());
}

export function usePortfolio() {
  return useQuery({
    queryKey: portfolioQueryKey,
    queryFn: getPortfolio,
    staleTime: 5 * 60_000,
  });
}
