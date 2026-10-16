"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { ExperimentMirrorMode } from "../model/mirrorAuto";
import {
  type BudgetForm,
  controlConflictSchema,
  type DemoResetRequest,
  type DemoResetResult,
  demoResetResultSchema,
  type ExperimentEnabled,
  type ExperimentReset,
  type ExperimentResetResult,
  experimentResetResultSchema,
  type GroupResetRequest,
  type GroupResetResult,
  groupResetResultSchema,
  type LabSettings,
  labSettingsSchema,
  type ResetRequest,
  type ResetResult,
  resetResultSchema,
} from "../model/settings";

// Хуки /settings лаборатории (spec 003, задача 3d).

export const labSettingsQueryKey = ["experiments", "settings"] as const;

/** Тело ошибки API настроек: { error }, у ответа 409 «контрольный с включёнными вариантами» — ещё variants (spec 0046). */
const errorBodySchema = controlConflictSchema.partial();

/**
 * Ошибка запроса настроек лаборатории. variants — включённые варианты контрольного из ответа 409: окно выключения
 * показывает по ним предупреждение и галочку, даже если данные страницы устарели (spec 0050).
 */
export class LabSettingsError extends Error {
  readonly status: number;
  readonly variants: string[];
  constructor(message: string, status: number, variants: string[] = []) {
    super(message);
    this.name = "LabSettingsError";
    this.status = status;
    this.variants = variants;
  }
}

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
    const parsed = errorBodySchema.safeParse(body);
    const error = parsed.success ? parsed.data : {};
    throw new LabSettingsError(
      error.error ?? `Сервер ответил ${res.status}`,
      res.status,
      error.variants,
    );
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

/** Положение демо-зеркала эксперимента «Выкл · Авто · Вкл» (spec 008, 0043): «Авто» сразу решает автомат. */
export function useSetExperimentMirrorMode() {
  const queryClient = useQueryClient();
  return useMutation<LabSettings, Error, ExperimentMirrorMode>({
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

/**
 * Остатки счетов в шапке (`entities/account-balance`, ключ ["accounts", "balances"]): сброс группы меняет Paper
 * группы, а демо-сброс — позиции демо-счёта. Ключ строкой, без импорта слайса: сущности одного слоя не знают друг о друге.
 */
const ACCOUNTS_QUERY_KEY = ["accounts"] as const;

/** Сброс группы активов (spec 0038): Paper или Demo всех экспериментов группы; эпоха и другие группы — без изменений. */
export function useResetGroup() {
  const queryClient = useQueryClient();
  return useMutation<GroupResetResult, Error, GroupResetRequest>({
    mutationFn: (body) =>
      request("/api/experiments/reset/group", groupResetResultSchema, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(labSettingsQueryKey, data.settings);
      void queryClient.invalidateQueries({ queryKey: ["experiments"] });
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
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
