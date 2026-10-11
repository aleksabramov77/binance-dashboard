import {
  experimentSchema,
  paperTradeSchema,
} from "@binance-dashboard/trading-core";
import { z } from "zod";
import { mirrorViewSchema } from "./mirror";

// Контракт API страниц лаборатории: GET /api/experiments и GET /api/experiments/[id] (spec 003, 3b).

export const tradeStatsSchema = z.object({
  trades: z.number(),
  closed: z.number(),
  open: z.number(),
  wins: z.number(),
  losses: z.number(),
  winRate: z.number().nullable(),
  realizedPnl: z.number(),
  fees: z.number(),
  grossProfit: z.number(),
  grossLoss: z.number(),
  profitFactor: z.number().nullable(),
  avgR: z.number().nullable(),
  maxDrawdown: z.number(),
  maxDrawdownPct: z.number(),
  initialBudget: z.number(),
  equity: z.number(),
});

export const equityPointSchema = z.object({
  at: z.string(),
  equity: z.number(),
});

export const runInfoSchema = z.object({
  id: z.number().int(),
  startedAt: z.string(),
});

/** Демо-торговля эксперимента с последнего демо-сброса (spec 008), см. MirrorSummary. */
export const demoSummarySchema = z.object({
  trades: z.number().int(),
  open: z.number().int(),
  closed: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  rejected: z.number().int(),
  pnl: z.number(),
});

export const experimentSummarySchema = experimentSchema
  .pick({
    id: true,
    market: true,
    name: true,
    hypothesis: true,
    initialBudget: true,
    enabled: true,
    demoMirror: true,
  })
  .extend({ stats: tradeStatsSchema, demo: demoSummarySchema });

export const experimentsResponseSchema = z.object({
  run: runInfoSchema,
  /** Тумблер движка: выключен — новых сделок не будет (пустое состояние страницы). */
  engineEnabled: z.boolean(),
  /** На сервере задан ключ Binance Demo — без него демо-торговля не включится (spec 008). */
  demoConfigured: z.boolean(),
  experiments: z.array(experimentSummarySchema),
});

export const experimentDetailResponseSchema = z.object({
  run: runInfoSchema,
  engineEnabled: z.boolean(),
  experiment: experimentSchema,
  stats: tradeStatsSchema,
  equity: z.array(equityPointSchema),
  /** Сделки эпохи, новые сверху; не больше limit из запроса. */
  trades: z.array(paperTradeSchema),
  /** Демо-торговля эксперимента с последнего демо-сброса. */
  demo: demoSummarySchema,
  /** Demo-зеркало показанных сделок: id сделки → статус (spec 008). Нет ключа — не зеркалилась. */
  mirrors: z.record(z.string(), mirrorViewSchema),
});

export type TradeStatsView = z.infer<typeof tradeStatsSchema>;
export type EquityPointView = z.infer<typeof equityPointSchema>;
export type DemoSummary = z.infer<typeof demoSummarySchema>;
export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;
export type ExperimentsResponse = z.infer<typeof experimentsResponseSchema>;
export type ExperimentDetailResponse = z.infer<
  typeof experimentDetailResponseSchema
>;
