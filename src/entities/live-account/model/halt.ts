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
      /** Сколько позиций ещё открыто после прогона: «Закрыть всё» держится, пока не 0. */
      remaining: z.number().default(0),
      /** Прогонов воркера по этому запросу. */
      runs: z.number().default(1),
    })
    .nullable(),
});
export type LiveHalt = z.infer<typeof liveHaltSchema>;

export const LIVE_HALT_ACTIONS = ["stop", "resume", "close_all"] as const;
export const liveHaltActionSchema = z.object({
  action: z.enum(LIVE_HALT_ACTIONS),
});
export type LiveHaltActionRequest = z.infer<typeof liveHaltActionSchema>;

/** Реальная позиция для карточки и полосы на /experiments (spec 0049, AC7). */
export const livePositionSchema = z.object({
  tradeId: z.string(),
  experimentId: z.string(),
  market: z.enum(["spot", "usdm"]),
  symbol: z.string(),
  direction: z.enum(["long", "short"]),
  status: z.string(),
  quantity: z.number().nullable(),
  entryPrice: z.number().nullable(),
  notionalUsd: z.number().nullable(),
  openedAt: isoTime,
  /** Нереализованный PnL по последней цене, ≈ $; null — цены нет. */
  pnlUsd: z.number().nullable(),
});
export type LivePosition = z.infer<typeof livePositionSchema>;

/** Эксперимент с включённым «Реальным счётом»: дневной реализованный PnL и сработавший лимит. */
export const liveExperimentDaySchema = z.object({
  id: z.string(),
  name: z.string(),
  market: z.string(),
  dailyPnl: z.number(),
  /** Дневной лимит сработал: новые входы до `until` (полночь UTC). */
  limitHit: z.boolean(),
  until: isoTime,
});
export type LiveExperimentDay = z.infer<typeof liveExperimentDaySchema>;

/** Закрытая реальная сделка для карточки: PnL и нераспроданный остаток (в PnL не входит). */
export const liveClosedSchema = z.object({
  tradeId: z.string(),
  experimentId: z.string(),
  symbol: z.string(),
  closedAt: isoTime,
  realizedPnl: z.number().nullable(),
  closedBy: z.string().nullable(),
  leftoverQty: z.number().nullable(),
  leftoverUsd: z.number().nullable(),
});
export type LiveClosed = z.infer<typeof liveClosedSchema>;

/** Торговля реального счёта (часть GET /api/live/status). */
export const liveTradingSchema = z.object({
  halt: liveHaltSchema,
  positions: z.array(livePositionSchema),
  /** Последние закрытые реальные сделки (до 5). */
  recent: z.array(liveClosedSchema),
  /** Дневной PnL и лимит всех экспериментов, у которых были реальные сделки сегодня или включён «Реальный счёт». */
  experiments: z.array(liveExperimentDaySchema),
});
export type LiveTrading = z.infer<typeof liveTradingSchema>;
