import { z } from "zod";

// Авто-зеркало (spec 0043): положение переключателя демо-зеркала и последнее решение автомата.

/** Положения переключателя в порядке на экране: «Выкл · Авто · Вкл». */
export const DEMO_MIRROR_MODES = ["off", "auto", "on"] as const;
export const demoMirrorModeSchema = z.enum(DEMO_MIRROR_MODES);
/** `auto` — зеркало ставит автомат; `on` / `off` — ручное решение пользователя (автомат только подсказывает). */
export type DemoMirrorMode = z.infer<typeof demoMirrorModeSchema>;

/** Подсказка по ручному положению — что сделал бы автомат: `on` — включил бы, `off` — выключил бы. */
export const mirrorAdviceSchema = z.enum(["on", "off"]);
export type MirrorAdvice = z.infer<typeof mirrorAdviceSchema>;

/**
 * Решение автомата по эксперименту: `enable` — включить (правило 1), `disable_loss` — выключить по обратному порогу
 * (правило 3), `disable_off` — эксперимент выключен (правило 2), `keep` — оставить как есть, `no_key` — включил бы,
 * но на сервере нет ключа Binance Demo.
 */
export const mirrorAutoDecisionSchema = z.enum([
  "enable",
  "disable_loss",
  "disable_off",
  "keep",
  "no_key",
]);
export type MirrorAutoDecision = z.infer<typeof mirrorAutoDecisionSchema>;

/** Одно решение автомата: что решил и по каким числам. */
export const mirrorAutoStepSchema = z.object({
  decision: mirrorAutoDecisionSchema,
  /** Зеркало после решения. */
  demoMirror: z.boolean(),
  /** Сколько сделок окна учтено (для обратного порога — последние 30). */
  trades: z.number().int(),
  /** Средний R этих сделок; null — сделок нет. */
  avgR: z.number().nullable(),
});
export type MirrorAutoStep = z.infer<typeof mirrorAutoStepSchema>;

/**
 * Авто-зеркало эксперимента (experiments.demo_mirror_auto) — подсказка у переключателя «Авто»: последняя проверка
 * (каждый прогон) и последнее изменение зеркала автоматом — «оставил» его не затирает.
 */
export const mirrorAutoSnapshotSchema = z.object({
  checkedAt: z.string(),
  check: mirrorAutoStepSchema,
  /** null — автомат ещё не менял зеркало. */
  change: mirrorAutoStepSchema.extend({ at: z.string() }).nullable(),
});
export type MirrorAutoSnapshot = z.infer<typeof mirrorAutoSnapshotSchema>;

/** POST /api/experiments/settings/mirror: положение переключателя. */
export const experimentMirrorModeSchema = z.object({
  id: z.string().min(1),
  mode: demoMirrorModeSchema,
});
export type ExperimentMirrorMode = z.infer<typeof experimentMirrorModeSchema>;
