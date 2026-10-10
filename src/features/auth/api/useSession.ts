"use client";

import { useQuery } from "@tanstack/react-query";
import { toAuthState } from "../model/schema";

/** Состояние входа: отключён локально / не вошли / вошли. */
async function getAuthState() {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (!res.ok) throw new Error(`Сессия недоступна (${res.status})`);
  return toAuthState(await res.json());
}

export function useSession() {
  return useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthState,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
