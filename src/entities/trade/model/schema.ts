import { z } from "zod";
import { demoProtectRefsSchema, tradeMarketSchema } from "@/shared/api/binance";

export const MAX_LEVERAGE = 3;
/** Максимальная потеря на стопе — доля баланса кошелька (2%). Проверяется и в UI, и на сервере. */
export const MAX_RISK_PCT = 0.02;

export const tradeRequestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]+USDT$/),
  market: tradeMarketSchema,
  direction: z.enum(["long", "short"]),
  quantity: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  leverage: z.number().int().min(1).max(MAX_LEVERAGE),
  setupId: z.string().optional(),
  /**
   * Объём чуть ниже минимума символа (после округления количества) — поднять до минимума,
   * но не больше чем втрое. Для demo-зеркала: $50 у BTCUSDT-фьючерсов округляются до $49,77.
   */
  fitMinNotional: z.boolean().optional(),
  /**
   * Только стоп, без тейка: spot — STOP_LOSS-ордер вместо OCO, futures — без TAKE_PROFIT.
   * Для demo-зеркала стратегий без TP (трейлинг, выход по сигналу/времени): «дальний» TP
   * Binance отклоняет фильтром PERCENT_PRICE_BY_SIDE, а с ним не встаёт и стоп.
   */
  stopOnly: z.boolean().optional(),
  /**
   * Вход demo-зеркала (spec 0012, PR 2d): своя сторона символа может быть общей с другими зеркалами
   * (у каждого свои TP/SL на свой объём). Ручной вход (без флага) — только на свободную сторону.
   */
  mirror: z.boolean().optional(),
});

export const tradeStepSchema = z.object({
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});

export const tradeResultSchema = z.object({
  id: z.string(),
  at: z.string(),
  /** Площадка: demo — Binance Demo Trading, live — реальный субсчёт (воркер, spec 0049). */
  environment: z.enum(["demo", "live"]),
  request: tradeRequestSchema,
  /** protected — позиция открыта и TP/SL выставлены; unprotected — открыта без защиты. */
  status: z.enum(["protected", "unprotected", "rejected"]),
  entryPrice: z.number().nullable(),
  filledQuantity: z.number().nullable(),
  steps: z.array(tradeStepSchema),
  message: z.string(),
  /**
   * Свои защитные ордера на демо (spec 0012, PR 2b): по ним закрытие снимает только их. Нет у
   * rejected; у старых путей и ответов — нет поля.
   */
  protectRefs: demoProtectRefsSchema.nullable().optional(),
});

export const tradeOverviewSchema = z.object({
  configured: z.boolean(),
  maxNotionalUsd: z.number(),
  balances: z.object({ spot: z.number(), usdm: z.number() }).nullable(),
  /** Символы с открытой позицией или ордерами на демо — в эти сетапы мы уже зашли. */
  openSymbols: z
    .object({ spot: z.array(z.string()), usdm: z.array(z.string()) })
    .nullable(),
  error: z.string().nullable(),
});

export const TRADE_STATUSES = [
  "open",
  "open-trailing",
  "open-unprotected",
  "tp",
  "stop-profit",
  "sl",
  "manual-profit",
  "manual-loss",
  "liquidation",
  "unknown",
] as const;

export const tradeStatusSchema = z.enum(TRADE_STATUSES);

/** Исполненный ордер с демо-счёта Binance: все его fills сложены в одну строку. */
export const executedOrderSchema = z.object({
  id: z.string(),
  market: tradeMarketSchema,
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  /** Время последнего исполнения, ISO. */
  at: z.string(),
  quantity: z.number(),
  avgPrice: z.number(),
  quoteQty: z.number(),
  commissions: z.array(z.object({ asset: z.string(), amount: z.number() })),
  /** PnL выхода: futures — от Binance, spot — от средней цены входа. У входа — 0/null. */
  realizedPnl: z.number().nullable(),
  /** Сделка, к которой относится ордер: один статус у входа и выхода. */
  trade: z.object({
    status: tradeStatusSchema,
    role: z.enum(["entry", "exit"]),
    /** Открытая сделка: текущий защитный стоп на бирже. */
    stopPrice: z.number().nullable(),
    /** Открытая сделка на фьючерсах: нереализованный PnL позиции. */
    unrealizedPnl: z.number().nullable(),
  }),
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
export type TradeStatus = z.infer<typeof tradeStatusSchema>;
export type TradeMark = ExecutedOrder["trade"];
export type TradeHistory = z.infer<typeof tradeHistorySchema>;
