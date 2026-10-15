import { z } from "zod";

/**
 * Группы активов (AG, spec 0016/0023): spot — Spot; usdm — USDⓈ-M Futures (маржа в стейблкоинах,
 * fapi); coinm — COIN-M Futures (инверсные контракты с маржой в монете, dapi). Ключ БД и URL.
 */
export const MARKETS = ["spot", "usdm", "coinm"] as const;
export const marketSchema = z.enum(MARKETS);
export type ExperimentMarket = z.infer<typeof marketSchema>;

/** Вид группы: фьючерсы умеют шорт, плечо и funding. Ветвления движка — по нему, а не по имени группы. */
export type MarketKind = "spot" | "futures";
export const MARKET_KIND: Record<ExperimentMarket, MarketKind> = {
  spot: "spot",
  usdm: "futures",
  coinm: "futures",
};
export const isFuturesMarket = (market: ExperimentMarket) =>
  MARKET_KIND[market] === "futures";

/** Имя группы USDⓈ-M до spec 0023 — в журнале и старых ссылках (`?market=futures`) читается как usdm. */
const LEGACY_MARKETS: Record<string, ExperimentMarket> = { futures: "usdm" };

/** Старое имя группы → новое; остальные значения — как есть (проверит схема). */
export const normalizeMarket = (value: unknown): unknown =>
  typeof value === "string" ? (LEGACY_MARKETS[value] ?? value) : value;

/** marketSchema, принимающая и старое имя группы: для журнала, URL и запросов от старых клиентов. */
export const legacyMarketSchema = z.preprocess(normalizeMarket, marketSchema);

/**
 * Объект с полем market: старое имя группы → новое (preprocess для discriminatedUnion по market —
 * ссылки на ордера зеркала и сделок). Единственная реализация чтения старого имени (spec 0023).
 */
export const withLegacyMarketField = (value: unknown): unknown =>
  value !== null &&
  typeof value === "object" &&
  "market" in value &&
  value.market !== normalizeMarket(value.market)
    ? { ...value, market: normalizeMarket(value.market) }
    : value;

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

/** Базы мейджоров: символ — по формату группы (BTCUSDT, BTCUSD_PERP). */
export const MAJOR_BASES = ["BTC", "ETH", "SOL", "BNB", "XRP"];

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
