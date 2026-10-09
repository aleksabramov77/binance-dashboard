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
  quoteVolumeUsd: z.number(),
  indicators: indicatorsSchema,
  /** Торгуется ли символ в Binance Demo Trading; null — не удалось проверить. */
  demoTradable: z.boolean().nullable().optional(),
});

/** Разбор сетапа языковой моделью: аргументы, риски и вердикт. */
export const setupAnalysisSchema = z.object({
  verdict: z.enum(["take", "wait", "skip"]),
  /** Уверенность модели в вердикте, 0–100. */
  confidence: z.number().transform((v) => Math.min(100, Math.max(0, v))),
  summary: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  /** При каком условии идея ломается и сделку надо закрыть/не открывать. */
  invalidation: z.string(),
});

export const setupAnalysisResultSchema = z.object({
  setupId: z.string(),
  model: z.string(),
  createdAt: z.string(),
  analysis: setupAnalysisSchema,
  costUsd: z.number().nullable(),
});

/** Предпроверка перед сделкой по свежим данным. */
export const setupRecheckSchema = z.object({
  checkedAt: z.string(),
  /** actual — всё как было; changed — актуален, но уровни сдвинулись; stale — входить уже не стоит. */
  status: z.enum(["actual", "changed", "stale"]),
  price: z.number(),
  /** Пересчитанный сетап (null, если правила больше не выполняются). */
  fresh: setupSchema.nullable(),
  notes: z.array(z.string()),
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
export type SetupAnalysis = z.infer<typeof setupAnalysisSchema>;
export type SetupAnalysisResult = z.infer<typeof setupAnalysisResultSchema>;
export type SetupRecheck = z.infer<typeof setupRecheckSchema>;
