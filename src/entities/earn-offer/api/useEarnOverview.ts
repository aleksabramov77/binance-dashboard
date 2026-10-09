"use client";

import { useQuery } from "@tanstack/react-query";
import { getEarnOverview } from "./getEarnOverview";

export const earnOverviewQueryKey = ["earn-overview"] as const;

export function useEarnOverview() {
  return useQuery({ queryKey: earnOverviewQueryKey, queryFn: getEarnOverview });
}
