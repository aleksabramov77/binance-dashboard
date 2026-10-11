"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { ExperimentDemoMirror } from "../model/mirror";
import {
  type BudgetForm,
  type DemoResetRequest,
  type DemoResetResult,
  demoResetResultSchema,
  type ExperimentEnabled,
  type ExperimentReset,
  type ExperimentResetResult,
  experimentResetResultSchema,
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

/** Demo-зеркало эксперимента (spec 008): новые paper-сделки повторяются на Binance Demo. */
export function useSetExperimentDemoMirror() {
  const queryClient = useQueryClient();
  return useMutation<LabSettings, Error, ExperimentDemoMirror>({
    mutationFn: (body) =>
      request("/api/experiments/settings/mirror", labSettingsSchema, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(labSettingsQueryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
  });
}

/** Отдельный сброс paper-капитала эксперимента: меняются его сделки и статистика. */
export function useResetExperimentPaper() {
  const queryClient = useQueryClient();
  return useMutation<ExperimentResetResult, Error, ExperimentReset>({
    mutationFn: (body) =>
      request("/api/experiments/reset/paper", experimentResetResultSchema, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(labSettingsQueryKey, data.settings);
      void queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
  });
}

/** Демо-сброс эксперимента (id) или всех (null): закрыть демо-позиции, обнулить демо-статистику. */
export function useResetDemo() {
  const queryClient = useQueryClient();
  return useMutation<DemoResetResult, Error, DemoResetRequest>({
    mutationFn: (body) =>
      request("/api/experiments/reset/demo", demoResetResultSchema, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(labSettingsQueryKey, data.settings);
      void queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
  });
}
