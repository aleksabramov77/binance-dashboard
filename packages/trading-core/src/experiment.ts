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
  z.strictObject({
    type: z.literal("counterTrend"),
    mode: z.enum(["rebound", "overheat", "both", "pumpContinuation"]),
  }),
  z.strictObject({
    type: z.literal("emaCross"),
    fast: z.number().int(),
    slow: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("donchian"),
    period: z.number().int(),
    volumeMult: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("rsi2"),
    threshold: z.number(),
    trendSma: z.number().int(),
  }),
  z.strictObject({ type: z.literal("bbReversion"), rsiMax: z.number() }),
  z.strictObject({ type: z.literal("bbSqueeze"), maxWidth: z.number() }),
  z.strictObject({ type: z.literal("macd"), minAdx: z.number().optional() }),
  z.strictObject({
    type: z.literal("supertrend"),
    period: z.number().int(),
    mult: z.number(),
  }),
  z.strictObject({ type: z.literal("volumeSpike"), mult: z.number() }),
  z.strictObject({ type: z.literal("emaPullback") }),
  z.strictObject({
    type: z.literal("momentum"),
    lookbackBars: z.number().int(),
    topK: z.number().int(),
  }),
  z.strictObject({ type: z.literal("random"), probability: z.number() }),
  z.strictObject({ type: z.literal("hold") }),
  z.strictObject({ type: z.literal("funding"), threshold: z.number() }),
]);
export type EntryRule = z.infer<typeof entrySchema>;
export type EntryType = EntryRule["type"];

export const exitSchema = z.strictObject({
  /** atr — mult × ATR; pct — % от входа; signal — уровень от сигнала (swing); none — без стопа. */
  stop: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("atr"), mult: z.number() }),
    z.strictObject({ type: z.literal("pct"), pct: z.number() }),
    z.strictObject({ type: z.literal("signal") }),
    z.strictObject({ type: z.literal("none") }),
  ]),
  /** rr — r × риск; pct; signal — цель от сигнала (средняя BB, EMA20). null — без TP. */
  takeProfit: z
    .discriminatedUnion("type", [
      z.strictObject({ type: z.literal("rr"), r: z.number() }),
      z.strictObject({ type: z.literal("pct"), pct: z.number() }),
      z.strictObject({ type: z.literal("signal") }),
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

export const universeSchema = z.strictObject({
  /** majors; top — top-N по обороту за 24 ч; movers — N лидеров роста и N падения; symbols — список. */
  type: z.enum(["majors", "top", "movers", "symbols"]),
  n: z.number().int().optional(),
  symbols: z.array(z.string()).optional(),
  blacklist: z.array(z.string()).optional(),
});
export type Universe = z.infer<typeof universeSchema>;

/** Где цена закрытия относительно EMA: выше, ниже или не важно. */
const regimeSideSchema = z.enum(["above", "below", "any"]);
export type RegimeSide = z.infer<typeof regimeSideSchema>;

/** Символ по умолчанию для режима рынка: весь рынок крипты идёт за BTC. */
const REGIME_SYMBOL = "BTCUSDT";

/**
 * Наибольший период EMA фильтра режима. Движок держит ENGINE.signalCandles (300) закрытых свечей на
 * (рынок, символ, TF) — с запасом на ADX и на свечи, которые Binance ещё не отдал; период больше
 * истории молча запрещал бы все входы, поэтому схема его не пропускает.
 */
export const REGIME_MAX_EMA = 250;

/**
 * Фильтр режима рынка: вход разрешён, только если на последней закрытой свече timeframe символа
 * (по умолчанию BTCUSDT) close по отношению к EMA(ema) совпадает с условием направления сделки,
 * а при minAdx — ещё и ADX(14) ≥ minAdx. Нет данных — вход запрещён.
 */
export const marketFilterSchema = z.strictObject({
  symbol: z.string().min(1).default(REGIME_SYMBOL),
  timeframe: timeframeSchema,
  ema: z.number().int().positive().max(REGIME_MAX_EMA),
  minAdx: z.number().positive().optional(),
  long: regimeSideSchema,
  short: regimeSideSchema,
});
export type MarketFilter = z.infer<typeof marketFilterSchema>;

const hourSchema = z.number().int().min(0);

/**
 * Фильтр торговых часов (UTC): hoursUtc — окно [from, to) по часу входа, from > to — через полночь
 * ([22, 6) — с 22:00 до 06:00); days — дни недели UTC (0 — воскресенье … 6 — суббота).
 */
export const sessionFilterSchema = z
  .strictObject({
    hoursUtc: z
      .tuple([hourSchema.max(23), hourSchema.max(24)])
      .refine(([from, to]) => from !== to, "пустое окно: from = to")
      .optional(),
    days: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  })
  .refine(
    (f) => f.hoursUtc !== undefined || f.days !== undefined,
    "нужно hoursUtc или days",
  );
export type SessionFilter = z.infer<typeof sessionFilterSchema>;

export const experimentConfigSchema = z.strictObject({
  timeframe: timeframeSchema,
  entry: entrySchema,
  exit: exitSchema,
  universe: universeSchema,
  directions: z.array(directionSchema).min(1),
  /** Фильтр тренда старшего ТФ: long только выше EMA(period), short — ниже. */
  trendFilter: z
    .strictObject({ timeframe: timeframeSchema, period: z.number().int() })
    .optional(),
  /** Фильтр режима рынка по BTC (или другому символу) на старшем ТФ — ./filters.ts. */
  marketFilter: marketFilterSchema.optional(),
  /** Фильтр торговых часов и дней недели (UTC) — ./filters.ts. */
  sessionFilter: sessionFilterSchema.optional(),
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
