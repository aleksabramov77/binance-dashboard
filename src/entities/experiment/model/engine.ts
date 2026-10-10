import { z } from "zod";
// Контракт API движка лаборатории (/api/experiments/engine): общий для роута и будущего хедера.

export const engineRunnerSchema = z.enum(["oracle", "supabase"]);

export const engineToggleSchema = z.object({ enabled: z.boolean() });

/** Итог последнего тика (engine_state.last_tick). */
export const engineTickSchema = z.object({
  status: z.enum(["ok", "disabled", "foreign-runner"]),
  runner: engineRunnerSchema,
  at: z.string(),
  opened: z.number(),
  closed: z.number(),
  evaluated: z.array(z.string()),
  errors: z.array(z.string()),
});

export const engineStatusSchema = z.object({
  /** Тумблер «Автоторговля» (engine_state.enabled), по умолчанию выключен. */
  enabled: z.boolean(),
  /** Кто сейчас исполняет тики (engine_state.runner). */
  runner: engineRunnerSchema,
  /** Роль этого процесса (ENGINE_RUNNER); не совпадает с runner — его тики ничего не делают. */
  processRunner: engineRunnerSchema,
  lastTick: engineTickSchema.nullable(),
});

export type EngineStatus = z.infer<typeof engineStatusSchema>;
export type EngineTick = z.infer<typeof engineTickSchema>;
