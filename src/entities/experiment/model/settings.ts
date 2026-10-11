import { marketSchema } from "@binance-dashboard/trading-core";
import { z } from "zod";
// Контракт /settings лаборатории (spec 003, задача 3d): эпоха, стартовый бюджет, тумблеры экспериментов.

export const DEFAULT_INITIAL_BUDGET = 10_000;
export const MIN_INITIAL_BUDGET = 100;
export const MAX_INITIAL_BUDGET = 1_000_000;
/** Слово, которое нужно ввести, чтобы подтвердить сброс. */
export const RESET_CONFIRM_WORD = "СБРОС";

/** Стартовый бюджет на эксперимент (USD) — форма /settings и POST /api/experiments/settings/budget. */
export const budgetFormSchema = z.object({
  initialBudget: z
    .number({ error: "Введите число" })
    .int("Только целое число долларов")
    .min(MIN_INITIAL_BUDGET, `Не меньше $${MIN_INITIAL_BUDGET}`)
    .max(MAX_INITIAL_BUDGET, `Не больше $${MAX_INITIAL_BUDGET}`),
});
export type BudgetForm = z.infer<typeof budgetFormSchema>;

/**
 * Запрос сброса. fromRunId — эпоха, которую пользователь видел на странице: если она уже не
 * текущая (повторный клик, вторая вкладка), сброс ничего не делает — две эпохи не создаются.
 */
export const resetRequestSchema = z.object({
  fromRunId: z.number().int().positive(),
  note: z.string().trim().max(200).optional(),
});
export type ResetRequest = z.infer<typeof resetRequestSchema>;

export const experimentEnabledSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});
export type ExperimentEnabled = z.infer<typeof experimentEnabledSchema>;

export const epochSchema = z.object({
  id: z.number().int(),
  startedAt: z.string(),
  note: z.string().nullable(),
  trades: z.number().int(),
  openTrades: z.number().int(),
});
export type Epoch = z.infer<typeof epochSchema>;

export const labSettingsSchema = z.object({
  epoch: epochSchema,
  /** Бюджет, с которым идёт текущая эпоха (по экспериментам; разный — максимум). */
  currentBudget: z.number(),
  /** Бюджет для следующей эпохи — вступит после сброса. */
  nextBudget: z.number(),
  /** На сервере задан ключ Binance Demo — без него зеркало не может торговать (spec 008). */
  demoConfigured: z.boolean(),
  experiments: z.array(
    z.object({
      id: z.string(),
      market: marketSchema,
      name: z.string(),
      hypothesis: z.string(),
      enabled: z.boolean(),
      demoMirror: z.boolean(),
      initialBudget: z.number(),
    }),
  ),
});
export type LabSettings = z.infer<typeof labSettingsSchema>;

export const resetResultSchema = z.object({
  /** false — эпоха fromRunId уже не текущая, ничего не сделано. */
  created: z.boolean(),
  epoch: epochSchema,
  /** Сколько открытых сделок закрыто (exit_reason manual). */
  closed: z.number().int(),
  /** Из них без цены — по цене входа, PnL 0. */
  closedWithoutPrice: z.number().int(),
});
export type ResetResult = z.infer<typeof resetResultSchema>;
