import { z } from "zod";

// Аварийный стоп реального счёта (spec 0049, AC6): «Стоп входов» / «Возобновить» и «Закрыть всё».

const isoTime = z.iso.datetime({ offset: true });

export const liveHaltSchema = z.object({
  /** Новые реальные входы остановлены. */
  stopped: z.boolean(),
  stoppedAt: isoTime.nullable(),
  /** Кто остановил или возобновил последним. */
  stoppedBy: z.string().nullable(),
  /** «Закрыть всё» запрошено и воркер его ещё не выполнил. */
  closeAllRequestedAt: isoTime.nullable(),
  closeAllRequestedBy: z.string().nullable(),
  closeAllDoneAt: isoTime.nullable(),
  /** Итог последнего «Закрыть всё». */
  closeAllResult: z
    .object({
      closed: z.number(),
      failed: z.number(),
      errors: z.array(z.string()),
    })
    .nullable(),
});
export type LiveHalt = z.infer<typeof liveHaltSchema>;

export const LIVE_HALT_ACTIONS = ["stop", "resume", "close_all"] as const;
export const liveHaltActionSchema = z.object({
  action: z.enum(LIVE_HALT_ACTIONS),
});
export type LiveHaltActionRequest = z.infer<typeof liveHaltActionSchema>;
