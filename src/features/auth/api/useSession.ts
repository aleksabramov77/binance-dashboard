"use client";

import { useQuery } from "@tanstack/react-query";
import { sessionSchema } from "../model/schema";

/** Текущая сессия. Вход не настроен (локально) → 404 → null, меню не показываем. */
async function getSession() {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Сессия недоступна (${res.status})`);
  return sessionSchema.parse(await res.json());
}

export function useSession() {
  return useQuery({
    queryKey: ["auth-session"],
    queryFn: getSession,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
