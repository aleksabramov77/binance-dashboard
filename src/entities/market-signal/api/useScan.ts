"use client";

import { useQuery } from "@tanstack/react-query";
import { type ScanResult, scanResultSchema } from "../model/schema";

export const scanQueryKey = ["market-scan"] as const;

async function getScan(): Promise<ScanResult> {
  const res = await fetch("/api/signals", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Сканер не ответил (${res.status})`);
  }
  return scanResultSchema.parse(await res.json());
}

export function useScan() {
  return useQuery({
    queryKey: scanQueryKey,
    queryFn: getScan,
    refetchInterval: 5 * 60_000,
  });
}
