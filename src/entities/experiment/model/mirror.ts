import { z } from "zod";

// Demo-зеркало (spec 008): статусы зеркальной сделки на Binance Demo.

export const MIRROR_STATUSES = [
  "pending",
  "protected",
  "unprotected",
  "rejected",
  "closing",
  "closed",
  "close_failed",
] as const;
export const mirrorStatusSchema = z.enum(MIRROR_STATUSES);
export type MirrorStatus = z.infer<typeof mirrorStatusSchema>;

/**
 * Позиция на демо открыта — её надо закрыть вместе с paper-сделкой. close_failed — повторяем
 * попытку на следующем прогоне, пока не закроется.
 */
export const OPEN_MIRROR_STATUSES = [
  "protected",
  "unprotected",
  "close_failed",
] as const satisfies readonly MirrorStatus[];

/** Символ занят зеркалом: второй вход по нему не делаем (на фьючерсах TP/SL общие на символ). */
export const ACTIVE_MIRROR_STATUSES = [
  "pending",
  "protected",
  "unprotected",
  "closing",
  "close_failed",
] as const satisfies readonly MirrorStatus[];

export const MIRROR_STATUS_LABELS: Record<MirrorStatus, string> = {
  pending: "отправляется",
  protected: "открыта, TP/SL",
  unprotected: "открыта без защиты",
  rejected: "не открылась",
  closing: "закрывается",
  closed: "закрыта",
  close_failed: "не закрылась",
};

export const experimentDemoMirrorSchema = z.object({
  id: z.string().min(1),
  demoMirror: z.boolean(),
});
export type ExperimentDemoMirror = z.infer<typeof experimentDemoMirrorSchema>;

export const mirrorViewSchema = z.object({
  status: mirrorStatusSchema,
  message: z.string(),
});
export type MirrorView = z.infer<typeof mirrorViewSchema>;
