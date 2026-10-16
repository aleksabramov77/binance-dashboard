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

/** Базы мейджоров: символ — по формату группы (BTCUSDT, BTCUSD_PERP). */
export const MAJOR_BASES = ["BTC", "ETH", "SOL", "BNB", "XRP"];

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
  /**
   * Вариант эксперимента (spec 0046): id контрольного, рядом с которым проверяется одно изменение настроек.
   * Один уровень — у контрольного parentId нет. null/нет поля — самостоятельный эксперимент.
   */
  parentId: z.string().min(1).nullish(),
  /** Что изменено в варианте относительно контрольного — коротко, для людей («цель 3R вместо 2R»). */
  variantNote: z.string().trim().min(1).max(200).nullish(),
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

const contextNumber = z.number().nullable().optional();

/**
 * Снимок рынка на входе (spec 0030) — по закрытой свече сигнала ТФ эксперимента, без заглядывания вперёд;
 * расчёт — ./context.ts. null — не хватило истории; поля нет — сделка до spec 0030 (там `{}`). Не строгая
 * схема: поля, добавленные позже, не ломают чтение старым кодом.
 */
export const entryContextSchema = z.object({
  /** Версия набора полей. */
  v: z.number().int().optional(),
  /** ATR(14) / close, %. */
  atrPct: contextNumber,
  /** ADX(14) символа. */
  adx14: contextNumber,
  /** Ширина Bollinger(20, 2): (upper − lower) / middle, %. */
  bbWidthPct: contextNumber,
  /** RSI(14). */
  rsi14: contextNumber,
  /** Объём свечи сигнала / SMA20 объёма 20 предыдущих свечей. */
  volumeRatio: contextNumber,
  /** close / EMA200 − 1, %. */
  ema200DistPct: contextNumber,
  /** Изменение close за 24 ч до свечи сигнала, %. */
  change24hPct: contextNumber,
  /** Место символа в юниверсе эксперимента по обороту за 24 ч (1 — самый ликвидный) и размер юниверса. */
  universeRank: contextNumber,
  universeSize: contextNumber,
  /** Режим BTC по закрытым 4h: close выше EMA200, ADX(14), изменение за 24 ч (%). */
  btcAboveEma200_4h: z.boolean().nullable().optional(),
  btcAdx14_4h: contextNumber,
  btcChange24hPct: contextNumber,
  /** Ставка funding символа на входе (доля, 0,0001 = 0,01 %); spot — null. */
  funding: contextNumber,
  /** Час (0–23) и день недели (0 — воскресенье) входа по UTC. */
  hourUtc: contextNumber,
  weekday: contextNumber,
});
export type EntryContext = z.infer<typeof entryContextSchema>;

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
  /**
   * Худшая цена с момента входа (low для long, high для short; свеча выхода учтена) — MAE. null — сделка
   * открыта до spec 0030: история её цен не известна.
   */
  mae: z.number().nullable(),
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
  /** Снимок рынка на входе; `{}` — сделка до spec 0030. */
  entryContext: entryContextSchema,
});
export type PaperTrade = z.infer<typeof paperTradeSchema>;

/**
 * Почему сигнал не стал сделкой (spec 0030): лимит позиций эксперимента, символ уже в позиции у него,
 * не хватает свободных денег. Фильтры (направление, часы, режим, тренд) сюда не попадают: такие сигналы
 * эксперимент и не должен был брать.
 */
export const SKIP_REASONS = ["max-open", "symbol-busy", "no-budget"] as const;
export const skipReasonSchema = z.enum(SKIP_REASONS);
export type SkipReason = z.infer<typeof skipReasonSchema>;

/** Отсечённый сигнал: что было бы открыто, если бы не лимит. */
export const skippedSignalSchema = z.object({
  /** run-эксперимент-символ-свеча-причина: повтор тика на той же свече не дублирует запись. */
  id: z.string(),
  runId: z.number().int(),
  experimentId: z.string(),
  market: marketSchema,
  symbol: z.string(),
  direction: directionSchema,
  /** openTime свечи сигнала ТФ эксперимента, мс. */
  bar: z.number(),
  /** Время тика, ISO. */
  at: z.string(),
  reason: skipReasonSchema,
  /** Цена входа со слиппеджем, стоп и тейк, которые были бы у сделки. */
  entryPrice: z.number(),
  stop: z.number().nullable(),
  takeProfit: z.number().nullable(),
});
export type SkippedSignal = z.infer<typeof skippedSignalSchema>;
