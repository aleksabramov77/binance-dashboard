import { z } from "zod";
import { notifyRecordSchema } from "@/shared/notify";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export const logEntrySchema = z.object({
  ts: z.string(),
  level: z.enum(LOG_LEVELS),
  event: z.string(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      name: z.string(),
      message: z.string(),
      code: z.unknown().optional(),
      stack: z.string().optional(),
    })
    .optional(),
  /**
   * Уведомление записи (spec 0067): категория, срочность и итог доставки. Запись чужого вида не роняет страницу /logs —
   * поле просто пропадает.
   */
  notify: notifyRecordSchema.optional().catch(undefined),
});

export const logsResponseSchema = z.object({
  entries: z.array(logEntrySchema),
});

/** Ошибка из браузера, присланная в журнал. */
export const clientErrorSchema = z.object({
  source: z.string().max(100),
  message: z.string().max(1000),
  stack: z.string().max(4000).optional(),
  url: z.string().max(500).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  /** Версия сборки страницы (deploymentId); нет — не задана. */
  version: z.string().max(200).optional(),
});

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogEntry = z.infer<typeof logEntrySchema>;
