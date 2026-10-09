import { z } from "zod";

export const indicatorsSchema = z.object({
  rsi1h: z.number(),
  rsi4h: z.number(),
  atr1h: z.number(),
  ema20: z.number(),
  ema50: z.number(),
  /** Объём последних 3 ч относительно среднего за предыдущие сутки (1 = обычный). */
  volumeRatio: z.number(),
  /** На сколько ATR цена ушла от EMA50 (минус — ниже). */
  distanceAtr: z.number(),
});

export const moverSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  spot: z.boolean(),
  futures: z.boolean(),
  price: z.number(),
  /** Изменение за 24 ч долей (−0.08 = −8%). */
  change24h: z.number(),
  quoteVolumeUsd: z.number(),
  indicators: indicatorsSchema.nullable(),
});

export const setupSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  base: z.string(),
  kind: z.enum(["rebound-long", "overheat-short"]),
  direction: z.enum(["long", "short"]),
  market: z.enum(["spot", "futures"]),
  /** ready — есть подтверждающая свеча; watch — условия выполнены, ждём разворота. */
  status: z.enum(["ready", "watch"]),
  entry: z.number(),
  stopLoss: z.number(),
  takeProfit1: z.number(),
  takeProfit2: z.number(),
  /** Риск/прибыль до TP1. */
  rr: z.number(),
  /** Сила сигнала 0–1: насколько экстремальны RSI и отклонение от средней. */
  strength: z.number(),
  reasons: z.array(z.string()),
  change24h: z.number(),
});

export const scanResultSchema = z.object({
  scannedAt: z.string(),
  universeSize: z.number(),
  gainers: z.array(moverSchema),
  losers: z.array(moverSchema),
  setups: z.array(setupSchema),
});

export type Indicators = z.infer<typeof indicatorsSchema>;
export type Mover = z.infer<typeof moverSchema>;
export type Setup = z.infer<typeof setupSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
