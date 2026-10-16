import { z } from "zod";
import { LIVE_AUTO } from "../config/liveAuto";

// Режимы реального счёта (spec 0053): положение переключателя, пороги автовыключения и последнее решение автомата.

/** Положения переключателя в порядке на экране: «Выкл · Авто · Вкл · Вкл + автовыкл». */
export const LIVE_MIRROR_MODES = ["off", "auto", "on", "on_autooff"] as const;
export const liveMirrorModeSchema = z.enum(LIVE_MIRROR_MODES);
/**
 * `off` — выключен; `auto` — включает и выключает автомат (по демо и порогам); `on` — ручное «Вкл», автомат не меняет
 * (только подсказывает); `on_autooff` — ручное «Вкл», приложение выключает по порогам.
 */
export type LiveMirrorMode = z.infer<typeof liveMirrorModeSchema>;

/** Пороги автовыключения эксперимента: убыток с момента включения, $, и убыточных сделок подряд. */
export const liveThresholdsSchema = z.object({
  lossUsd: z
    .number({ error: "Введите число" })
    .min(LIVE_AUTO.lossUsdMin, `Не меньше $${LIVE_AUTO.lossUsdMin}`)
    .max(LIVE_AUTO.lossUsdMax, `Не больше $${LIVE_AUTO.lossUsdMax}`),
  streak: z
    .number({ error: "Введите число" })
    .int("Целое число")
    .min(LIVE_AUTO.streakMin, `Не меньше ${LIVE_AUTO.streakMin}`)
    .max(LIVE_AUTO.streakMax, `Не больше ${LIVE_AUTO.streakMax}`),
});
export type LiveThresholds = z.infer<typeof liveThresholdsSchema>;

export const DEFAULT_LIVE_THRESHOLDS: LiveThresholds = {
  lossUsd: LIVE_AUTO.defaultLossUsd,
  streak: LIVE_AUTO.defaultStreak,
};

/** Сработавший порог: убыток в $ или серия убытков. */
export const liveTripSchema = z.enum(["loss", "streak"]);
export type LiveTrip = z.infer<typeof liveTripSchema>;

/**
 * Решение автомата: `enable` — «Авто» включил; `wait` — мало демо-сделок; `demo_negative` — демо-сделок хватает, но
 * средний R не выше 0; `paper_off` — эксперимент выключен; `keep` — включён, условия держатся; `disable_demo` —
 * средний R последних 30 демо-сделок < 0; `disable_loss` / `disable_streak` — сработал порог.
 */
export const liveAutoDecisionSchema = z.enum([
  "enable",
  "wait",
  "demo_negative",
  "paper_off",
  "keep",
  "disable_demo",
  "disable_loss",
  "disable_streak",
]);
export type LiveAutoDecision = z.infer<typeof liveAutoDecisionSchema>;

/** Последняя проверка «Авто» (experiments.live_mirror_auto) — для подписи и подсказки у переключателя. */
export const liveAutoSnapshotSchema = z.object({
  checkedAt: z.string(),
  decision: liveAutoDecisionSchema,
  /** Демо-сделок учтено (для обратного порога — последние 30) и их средний R; null — сделок нет. */
  demoTrades: z.number().int(),
  demoAvgR: z.number().nullable(),
  /** Демо-зеркало эксперимента включено (для «ждёт: 0 из 30, демо-зеркало выкл»). */
  demoMirror: z.boolean(),
  /** Реальный PnL с момента включения, $, и убыточных сделок подряд — для подсказки. */
  pnlUsd: z.number(),
  lossStreak: z.number().int(),
});
export type LiveAutoSnapshot = z.infer<typeof liveAutoSnapshotSchema>;

/** Автовыключение: когда и почему — пометка у «Выкл» до следующего ручного переключения. */
export const liveAutoOffSchema = z.object({
  at: z.string(),
  reason: z.string(),
});
export type LiveAutoOff = z.infer<typeof liveAutoOffSchema>;

/** POST /api/experiments/settings/live: положение переключателя, слово подтверждения и пороги. */
export const experimentLiveModeSchema = z.object({
  id: z.string().min(1),
  mode: liveMirrorModeSchema,
  /** Слово подтверждения (LIVE.confirmWord) — обязательно для всех положений, кроме «Выкл». */
  confirm: z.string().max(20).optional(),
  /** Пороги «Авто» и «Вкл + автовыкл»; не заданы — прежние эксперимента. */
  thresholds: liveThresholdsSchema.optional(),
});
export type ExperimentLiveMode = z.infer<typeof experimentLiveModeSchema>;

export const liveModeReplySchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  mode: liveMirrorModeSchema,
  liveMirror: z.boolean(),
});
