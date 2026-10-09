import { z } from "zod";

export const MAX_LEVERAGE = 3;

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
  trades: z.array(tradeResultSchema),
});

export type TradeRequest = z.infer<typeof tradeRequestSchema>;
export type TradeStep = z.infer<typeof tradeStepSchema>;
export type TradeResult = z.infer<typeof tradeResultSchema>;
export type TradeOverview = z.infer<typeof tradeOverviewSchema>;
