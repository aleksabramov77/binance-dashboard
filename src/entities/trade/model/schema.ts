import { z } from "zod";

export const MAX_LEVERAGE = 3;
/** Максимальная потеря на стопе — доля баланса кошелька (2%). Проверяется и в UI, и на сервере. */
export const MAX_RISK_PCT = 0.02;

export const tradeRequestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]+USDT$/),
  market: z.enum(["spot", "futures"]),
  direction: z.enum(["long", "short"]),
  quantity: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  leverage: z.number().int().min(1).max(MAX_LEVERAGE),
  setupId: z.string().optional(),
});

export const tradeStepSchema = z.object({
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});

export const tradeResultSchema = z.object({
  id: z.string(),
  at: z.string(),
  environment: z.literal("demo"),
  request: tradeRequestSchema,
  /** protected — позиция открыта и TP/SL выставлены; unprotected — открыта без защиты. */
  status: z.enum(["protected", "unprotected", "rejected"]),
  entryPrice: z.number().nullable(),
  filledQuantity: z.number().nullable(),
  steps: z.array(tradeStepSchema),
  message: z.string(),
});

export const tradeOverviewSchema = z.object({
  configured: z.boolean(),
  maxNotionalUsd: z.number(),
  balances: z.object({ spot: z.number(), futures: z.number() }).nullable(),
  error: z.string().nullable(),
});

/** Исполненный ордер с демо-счёта Binance: все его fills сложены в одну строку. */
export const executedOrderSchema = z.object({
  id: z.string(),
  market: z.enum(["spot", "futures"]),
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  /** Время последнего исполнения, ISO. */
  at: z.string(),
  quantity: z.number(),
  avgPrice: z.number(),
  quoteQty: z.number(),
  commissions: z.array(z.object({ asset: z.string(), amount: z.number() })),
  /** Только фьючерсы: зафиксированный PnL (у входа — 0). */
  realizedPnl: z.number().nullable(),
});

export const tradeHistorySchema = z.object({
  configured: z.boolean(),
  /** История могла загрузиться частично — тогда здесь текст ошибки. */
  error: z.string().nullable(),
  orders: z.array(executedOrderSchema),
});

export type TradeRequest = z.infer<typeof tradeRequestSchema>;
export type TradeStep = z.infer<typeof tradeStepSchema>;
export type TradeResult = z.infer<typeof tradeResultSchema>;
export type TradeOverview = z.infer<typeof tradeOverviewSchema>;
export type ExecutedOrder = z.infer<typeof executedOrderSchema>;
export type TradeHistory = z.infer<typeof tradeHistorySchema>;
