import { z } from "zod";

/** Что автоторговля сделала с сетапом за цикл. */
export const AUTO_TRADE_OUTCOMES = [
  "opened",
  "unprotected",
  "rejected",
  "skipped",
  "error",
] as const;

export const autoTradeActionSchema = z.object({
  at: z.string(),
  symbol: z.string(),
  market: z.enum(["spot", "futures"]),
  direction: z.enum(["long", "short"]),
  /** Статус сетапа в момент решения: ready — разворотная свеча есть, watch — ждём разворота. */
  setupStatus: z.enum(["ready", "watch"]),
  outcome: z.enum(AUTO_TRADE_OUTCOMES),
  reason: z.string(),
});

export const autoTradeStateSchema = z.object({
  enabled: z.boolean(),
  /** Когда включили (ISO); null — выключена. */
  enabledAt: z.string().nullable(),
  /** Конец последнего цикла (ISO). */
  lastCycleAt: z.string().nullable(),
  /** Ошибка последнего цикла целиком (скан не загрузился и т.п.). */
  lastError: z.string().nullable(),
  /** Пауза между циклами, мс. */
  intervalMs: z.number(),
  /** Последние решения, новые сверху. */
  actions: z.array(autoTradeActionSchema),
  /** «SYMBOL:direction» → время последнего автовхода (ISO) — для паузы перед повторным входом. */
  entries: z.record(z.string(), z.string()),
});

export const autoTradeToggleSchema = z.object({ enabled: z.boolean() });

export type AutoTradeAction = z.infer<typeof autoTradeActionSchema>;
export type AutoTradeOutcome = AutoTradeAction["outcome"];
export type AutoTradeState = z.infer<typeof autoTradeStateSchema>;
