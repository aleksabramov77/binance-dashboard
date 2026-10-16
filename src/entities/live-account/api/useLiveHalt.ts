"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LiveHaltActionRequest } from "../model/halt";
import { liveAccountQueryKey } from "./useLiveAccount";

/** Аварийный стоп реального счёта (spec 0049): «Стоп входов», «Возобновить», «Закрыть всё». */
export function useLiveHalt() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, LiveHaltActionRequest>({
    mutationFn: async (body) => {
      const res = await fetch("/api/live/halt", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const error = (data as { error?: string } | null)?.error;
        throw new Error(error ?? `Сервер ответил ${res.status}`);
      }
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: liveAccountQueryKey }),
  });
}
