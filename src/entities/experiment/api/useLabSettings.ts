"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import {
  type BudgetForm,
  type ExperimentEnabled,
  type LabSettings,
  labSettingsSchema,
  type ResetRequest,
  type ResetResult,
  resetResultSchema,
} from "../model/settings";

// Хуки /settings лаборатории (spec 003, задача 3d).

export const labSettingsQueryKey = ["experiments", "settings"] as const;

async function request<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: { method: string; body: unknown },
): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...(init && {
      method: init.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(init.body),
    }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `Сервер ответил ${res.status}`);
  }
  return schema.parse(body);
}

export function useLabSettings() {
  return useQuery({
    queryKey: labSettingsQueryKey,
    queryFn: () => request("/api/experiments/settings", labSettingsSchema),
    refetchInterval: 60_000,
  });
}

/** После сброса меняется всё, что считается по эпохе: инвалидируем весь ключ experiments. */
export function useResetCapitals() {
  const queryClient = useQueryClient();
  return useMutation<ResetResult, Error, ResetRequest>({
    mutationFn: (body) =>
      request("/api/experiments/reset", resetResultSchema, {
        method: "POST",
        body,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["experiments"] }),
  });
}

export function useSetNextBudget() {
  const queryClient = useQueryClient();
  return useMutation<LabSettings, Error, BudgetForm>({
    mutationFn: (body) =>
      request("/api/experiments/settings/budget", labSettingsSchema, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => queryClient.setQueryData(labSettingsQueryKey, data),
  });
}

export function useSetExperimentEnabled() {
  const queryClient = useQueryClient();
  return useMutation<LabSettings, Error, ExperimentEnabled>({
    mutationFn: (body) =>
      request("/api/experiments/settings/enabled", labSettingsSchema, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(labSettingsQueryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
  });
}
