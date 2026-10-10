import { z } from "zod";

export const MARKETS = ["spot", "futures"] as const;
export const marketSchema = z.enum(MARKETS);
export type ExperimentMarket = z.infer<typeof marketSchema>;

export const directionSchema = z.enum(["long", "short"]);
export type TradeDirection = z.infer<typeof directionSchema>;

export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;
export const timeframeSchema = z.enum(TIMEFRAMES);
export type Timeframe = z.infer<typeof timeframeSchema>;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/** Сигнал входа: тип и параметры. Логика — в ./strategies.ts. */
export const entrySchema = z.discriminatedUnion("type", [
  /** Сканер дашборда: отскок после падения / шорт после пампа / продолжение пампа. */
  z.object({
    type: z.literal("counterTrend"),
    mode: z.enum(["rebound", "overheat", "both", "pumpContinuation"]),
  }),
  z.object({
    type: z.literal("emaCross"),
    fast: z.number().int(),
    slow: z.number().int(),
  }),
  z.object({
    type: z.literal("donchian"),
    period: z.number().int(),
    volumeMult: z.number().optional(),
  }),
  z.object({
    type: z.literal("rsi2"),
    threshold: z.number(),
    trendSma: z.number().int(),
  }),
  z.object({ type: z.literal("bbReversion"), rsiMax: z.number() }),
  z.object({ type: z.literal("bbSqueeze"), maxWidth: z.number() }),
  z.object({ type: z.literal("macd"), minAdx: z.number().optional() }),
  z.object({
    type: z.literal("supertrend"),
    period: z.number().int(),
    mult: z.number(),
  }),
  z.object({ type: z.literal("volumeSpike"), mult: z.number() }),
  z.object({ type: z.literal("emaPullback") }),
  z.object({
    type: z.literal("momentum"),
    lookbackBars: z.number().int(),
    topK: z.number().int(),
  }),
  z.object({ type: z.literal("random"), probability: z.number() }),
  z.object({ type: z.literal("hold") }),
  z.object({ type: z.literal("funding"), threshold: z.number() }),
]);
export type EntryRule = z.infer<typeof entrySchema>;
export type EntryType = EntryRule["type"];

export const exitSchema = z.object({
  /** atr — mult × ATR; pct — % от входа; signal — уровень от сигнала (swing); none — без стопа. */
  stop: z.discriminatedUnion("type", [
    z.object({ type: z.literal("atr"), mult: z.number() }),
    z.object({ type: z.literal("pct"), pct: z.number() }),
    z.object({ type: z.literal("signal") }),
    z.object({ type: z.literal("none") }),
  ]),
  /** rr — r × риск; pct; signal — цель от сигнала (средняя BB, EMA20). null — без TP. */
  takeProfit: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("rr"), r: z.number() }),
      z.object({ type: z.literal("pct"), pct: z.number() }),
      z.object({ type: z.literal("signal") }),
    ])
    .nullable(),
  /** Трейлинг-стоп (chandelier): экстремум с входа ∓ mult × ATR на входе. */
  trailAtr: z.number().optional(),
  /** Перенос стопа в безубыток при +R. */
  breakevenAtR: z.number().optional(),
  /** Выход по времени: через N свечей таймфрейма эксперимента. */
  timeStopBars: z.number().int().optional(),
  /** Выход по противоположному сигналу стратегии (кросс назад, flip, close > SMA5). */
  exitOnSignal: z.boolean().optional(),
});
export type ExitRule = z.infer<typeof exitSchema>;

export const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

export const universeSchema = z.object({
  /** majors; top — top-N по обороту за 24 ч; movers — N лидеров роста и N падения; symbols — список. */
  type: z.enum(["majors", "top", "movers", "symbols"]),
  n: z.number().int().optional(),
  symbols: z.array(z.string()).optional(),
  blacklist: z.array(z.string()).optional(),
});
export type Universe = z.infer<typeof universeSchema>;

export const experimentConfigSchema = z.object({
  timeframe: timeframeSchema,
  entry: entrySchema,
  exit: exitSchema,
  universe: universeSchema,
  directions: z.array(directionSchema).min(1),
  /** Фильтр тренда старшего ТФ: long только выше EMA(period), short — ниже. */
  trendFilter: z
    .object({ timeframe: timeframeSchema, period: z.number().int() })
    .optional(),
  maxOpen: z.number().int().positive(),
});
export type ExperimentConfig = z.infer<typeof experimentConfigSchema>;

export const experimentSchema = z.object({
  id: z.string(),
  market: marketSchema,
  name: z.string(),
  /** Суть эксперимента: гипотеза простыми словами. */
  hypothesis: z.string(),
  config: experimentConfigSchema,
  initialBudget: z.number().positive(),
  enabled: z.boolean(),
  demoMirror: z.boolean(),
});
export type Experiment = z.infer<typeof experimentSchema>;

export const EXIT_REASONS = [
  "tp",
  "sl",
  "trail",
  "breakeven",
  "time",
  "signal",
  "manual",
] as const;
export const exitReasonSchema = z.enum(EXIT_REASONS);
export type ExitReason = z.infer<typeof exitReasonSchema>;

export const paperTradeSchema = z.object({
  id: z.string(),
  runId: z.number().int(),
  experimentId: z.string(),
  market: marketSchema,
  symbol: z.string(),
  direction: directionSchema,
  openedAt: z.string(),
  entryPrice: z.number(),
  quantity: z.number(),
  /** Стоп при входе — от него считается R. null — без стопа. */
  initialStop: z.number().nullable(),
  /** Текущий стоп (после трейлинга и безубытка). */
  stop: z.number().nullable(),
  takeProfit: z.number().nullable(),
  /** ATR при входе — для трейлинга. */
  atr: z.number(),
  /** Лучшая цена с момента входа (high для long, low для short). */
  extreme: z.number(),
  /** До какой минуты (openTime 1m-свечи) выходы уже проверены. */
  checkedUntil: z.number(),
  closedAt: z.string().nullable(),
  exitPrice: z.number().nullable(),
  exitReason: exitReasonSchema.nullable(),
  fees: z.number(),
  pnl: z.number().nullable(),
  rMultiple: z.number().nullable(),
  demoOrderRef: z.string().nullable(),
  signal: z.record(z.string(), z.unknown()),
});
export type PaperTrade = z.infer<typeof paperTradeSchema>;
