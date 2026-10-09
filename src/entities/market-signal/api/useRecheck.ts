"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type Setup,
  type SetupRecheck,
  setupRecheckSchema,
} from "../model/schema";

async function postRecheck(setup: Setup): Promise<SetupRecheck> {
  const res = await fetch("/api/signals/recheck", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(setup),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Проверка не удалась (${res.status})`);
  }
  return setupRecheckSchema.parse(body);
}

/** Свежая предпроверка сетапа; запускается заново при каждом открытии окна сделки. */
export function useRecheck(setup: Setup, enabled: boolean) {
  return useQuery({
    queryKey: ["setup-recheck", setup.id, setup.entry],
    queryFn: () => postRecheck(setup),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
