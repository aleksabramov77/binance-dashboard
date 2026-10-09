"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { earnOverviewQueryKey } from "@/entities/earn-offer";

async function refreshSnapshot(): Promise<void> {
  const res = await fetch("/api/earn/refresh", { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Обновление не удалось (${res.status})`);
  }
}

export function useRefreshSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshSnapshot,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: earnOverviewQueryKey }),
  });
}
