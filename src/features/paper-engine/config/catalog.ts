import type {
  Experiment,
  ExperimentConfig,
  ExperimentMarket,
} from "@binance-dashboard/trading-core";

/** Стартовый капитал каждого эксперимента, USD (spec 003). */
/** Бюджет рынка $10 000 на 20 экспериментов рынка (решение пользователя 2026-10-10). */
export const INITIAL_BUDGET = 500;

type Entry = Pick<Experiment, "id" | "name" | "hypothesis"> & {
  config: ExperimentConfig;
};

const make =
  (market: ExperimentMarket) =>
  ({ id, name, hypothesis, config }: Entry): Experiment => ({
    id,
    market,
    name,
    hypothesis,
    config,
    initialBudget: INITIAL_BUDGET,
    enabled: true,
    demoMirror: false,
  });

const LONG: ExperimentConfig["directions"] = ["long"];
const BOTH: ExperimentConfig["directions"] = ["long", "short"];
const SHORT: ExperimentConfig["directions"] = ["short"];

const TOP30 = { type: "top", n: 30 } as const;
const MOVERS = { type: "movers", n: 15 } as const;
const MAJORS_ONLY = { type: "majors" } as const;
const BTC: ExperimentConfig["universe"] = {
  type: "symbols",
  symbols: ["BTCUSDT"],
};
const EMA200_4H = { timeframe: "4h", period: 200 } as const;
const EMA200_1H = { timeframe: "1h", period: 200 } as const;

/** Монеты с худшим PnL ночного прогона spec 002 (9–10.10). */
const NIGHT_LOSERS = ["PIXEL", "MAGIC", "KAIA", "BAT", "Q", "OP"];

// Выходы, которые повторяются в нескольких экспериментах.
const SCANNER_EXIT: ExperimentConfig["exit"] = {
  stop: { type: "signal" },
  takeProfit: { type: "signal" },
};
const ATR15_RR2: ExperimentConfig["exit"] = {
  stop: { type: "atr", mult: 1.5 },
  takeProfit: { type: "rr", r: 2 },
};
const trail = (mult: number): ExperimentConfig["exit"] => ({
  stop: { type: "atr", mult },
  takeProfit: null,
  trailAtr: mult,
});

const S01: ExperimentConfig = {
  timeframe: "1h",
  entry: { type: "counterTrend", mode: "rebound" },
  exit: SCANNER_EXIT,
  universe: MOVERS,
  directions: LONG,
  maxOpen: 5,
};
const S04: ExperimentConfig = {
  timeframe: "15m",
  entry: { type: "emaCross", fast: 9, slow: 21 },
  exit: ATR15_RR2,
  universe: TOP30,
  directions: LONG,
  trendFilter: EMA200_1H,
  maxOpen: 5,
};
const S06: ExperimentConfig = {
  timeframe: "1h",
  entry: { type: "emaCross", fast: 20, slow: 50 },
  exit: trail(3),
  universe: TOP30,
  directions: LONG,
  maxOpen: 5,
};
const S07: ExperimentConfig = {
  timeframe: "1h",
  entry: { type: "donchian", period: 20, volumeMult: 1.5 },
  exit: trail(2),
  universe: TOP30,
  directions: LONG,
  maxOpen: 5,
};

/** Spot — только long. Каталог утверждён пользователем (spec 003, 2026-10-10). */
const SPOT: Entry[] = [
  {
    id: "S01",
    name: "Baseline: отскок сканера",
    hypothesis:
      "Контроль: покупаем монету после сильного падения за сутки, как сейчас делает сканер, с его стопом за минимумом и целью у EMA20.",
    config: S01,
  },
  {
    id: "S02",
    name: "Отскок + тренд 4h",
    hypothesis:
      "Отскок работает лучше, если монета в целом растёт: покупаем падение, только когда цена выше EMA200 на 4h.",
    config: { ...S01, trendFilter: EMA200_4H },
  },
  {
    id: "S03",
    name: "Отскок, TP 2R + безубыток",
    hypothesis:
      "Тот же вход, но цель дальше (2 риска), а после +1R стоп переносится в безубыток — меньше мелких потерь, больше крупных прибылей.",
    config: {
      ...S01,
      exit: {
        stop: { type: "signal" },
        takeProfit: { type: "rr", r: 2 },
        breakevenAtR: 1,
      },
    },
  },
  {
    id: "S04",
    name: "EMA 9/21, 15m, TP 2R",
    hypothesis:
      "Быстрая EMA пересекла медленную вверх — начало движения; входим только по часовому тренду (выше EMA200 1h), стоп 1,5 ATR, цель 2R.",
    config: S04,
  },
  {
    id: "S05",
    name: "EMA 9/21, 15m, трейлинг",
    hypothesis:
      "Тот же вход, что S04, но без фиксированной цели: трейлинг 3 ATR даёт тренду расти дальше.",
    config: { ...S04, exit: trail(3) },
  },
  {
    id: "S06",
    name: "EMA 20/50, 1h, трейлинг",
    hypothesis:
      "Медленное пересечение на часах ловит крупные тренды; держим, пока трейлинг 3 ATR не выбьет.",
    config: S06,
  },
  {
    id: "S07",
    name: "Donchian-20 + объём, 1h",
    hypothesis:
      "Пробой максимума 20 часов на объёме в 1,5 раза выше среднего — продолжение роста; трейлинг 2 ATR.",
    config: S07,
  },
  {
    id: "S08",
    name: "Donchian-55, 4h (черепахи)",
    hypothesis:
      "Классика «черепах»: пробой максимума 55 свечей 4h — долгий тренд, выходим трейлингом 3 ATR.",
    config: {
      timeframe: "4h",
      entry: { type: "donchian", period: 55 },
      exit: trail(3),
      universe: TOP30,
      directions: LONG,
      maxOpen: 5,
    },
  },
  {
    id: "S09",
    name: "RSI(2) Коннорса",
    hypothesis:
      "Короткая перепроданность (RSI2 < 10) в растущей монете (выше SMA200) быстро откупается: выходим, когда close выше SMA5, или через 10 баров.",
    config: {
      timeframe: "1h",
      entry: { type: "rsi2", threshold: 10, trendSma: 200 },
      exit: {
        stop: { type: "atr", mult: 3 },
        takeProfit: null,
        timeStopBars: 10,
        exitOnSignal: true,
      },
      universe: TOP30,
      directions: LONG,
      maxOpen: 5,
    },
  },
  {
    id: "S10",
    name: "Нижняя Bollinger + RSI < 30",
    hypothesis:
      "Касание нижней полосы Боллинджера при RSI < 30 в аптренде — возврат к средней линии.",
    config: {
      timeframe: "1h",
      entry: { type: "bbReversion", rsiMax: 30 },
      exit: {
        stop: { type: "atr", mult: 1.5 },
        takeProfit: { type: "signal" },
      },
      universe: TOP30,
      directions: LONG,
      trendFilter: EMA200_4H,
      maxOpen: 5,
    },
  },
  {
    id: "S11",
    name: "Сжатие Bollinger → пробой",
    hypothesis:
      "После затишья (узкие полосы) цена выстреливает; покупаем пробой верхней полосы, трейлинг 2 ATR.",
    config: {
      timeframe: "1h",
      entry: { type: "bbSqueeze", maxWidth: 0.04 },
      exit: trail(2),
      universe: TOP30,
      directions: LONG,
      maxOpen: 5,
    },
  },
  {
    id: "S12",
    name: "MACD вверх + EMA200",
    hypothesis:
      "Гистограмма MACD перешла в плюс выше EMA200 — импульс по тренду; цель 2R.",
    config: {
      timeframe: "1h",
      entry: { type: "macd" },
      exit: ATR15_RR2,
      universe: TOP30,
      directions: LONG,
      trendFilter: EMA200_1H,
      maxOpen: 5,
    },
  },
  {
    id: "S13",
    name: "Supertrend(10,3)",
    hypothesis:
      "Supertrend развернулся вверх — покупаем и держим до обратного разворота.",
    config: {
      timeframe: "1h",
      entry: { type: "supertrend", period: 10, mult: 3 },
      exit: { stop: { type: "signal" }, takeProfit: null, exitOnSignal: true },
      universe: TOP30,
      directions: LONG,
      maxOpen: 5,
    },
  },
  {
    id: "S14",
    name: "Всплеск объёма ×3",
    hypothesis:
      "Объём втрое выше среднего и закрытие у максимума — сильный покупатель; цель 1,5R, выход через 12 баров.",
    config: {
      timeframe: "1h",
      entry: { type: "volumeSpike", mult: 3 },
      exit: {
        stop: { type: "atr", mult: 1.5 },
        takeProfit: { type: "rr", r: 1.5 },
        timeStopBars: 12,
      },
      universe: TOP30,
      directions: LONG,
      maxOpen: 5,
    },
  },
  {
    id: "S15",
    name: "Откат к EMA20 в тренде",
    hypothesis:
      "В выстроенном тренде (EMA20 > EMA50 > EMA200) откат к EMA20 — дешёвая точка входа; цель 2R.",
    config: {
      timeframe: "1h",
      entry: { type: "emaPullback" },
      exit: ATR15_RR2,
      universe: TOP30,
      directions: LONG,
      maxOpen: 5,
    },
  },
  {
    id: "S16",
    name: "Majors + EMA 20/50",
    hypothesis:
      "Стратегия S06 только на крупных монетах (BTC, ETH, SOL, BNB, XRP): меньше шума альтов.",
    config: { ...S06, universe: MAJORS_ONLY },
  },
  {
    id: "S17",
    name: "Top-15 + Donchian-20",
    hypothesis:
      "Стратегия S07 только на 15 самых ликвидных монетах — проверяем, нужен ли фильтр ликвидности.",
    config: { ...S07, universe: { type: "top", n: 15 } },
  },
  {
    id: "S18",
    name: "Momentum: топ-3 за 7 дней",
    hypothesis:
      "Лидеры роста продолжают расти: раз в сутки держим 3 лучшие монеты за неделю из top-30 и меняем выбывших.",
    config: {
      timeframe: "1d",
      entry: { type: "momentum", lookbackBars: 7, topK: 3 },
      exit: {
        stop: { type: "atr", mult: 3 },
        takeProfit: null,
        exitOnSignal: true,
      },
      universe: TOP30,
      directions: LONG,
      maxOpen: 3,
    },
  },
  {
    id: "S19",
    name: "Контроль: случайный вход",
    hypothesis:
      "Случайная покупка со стопом 2 ATR и целью 2R — планка, которую должна побить любая стратегия.",
    config: {
      timeframe: "1h",
      entry: { type: "random", probability: 0.02 },
      exit: {
        stop: { type: "atr", mult: 2 },
        takeProfit: { type: "rr", r: 2 },
      },
      universe: TOP30,
      directions: LONG,
      maxOpen: 5,
    },
  },
  {
    id: "S20",
    name: "Контроль: buy & hold BTC",
    hypothesis:
      "Просто купить BTC и держать — бенчмарк рынка: стратегия хуже него не нужна.",
    config: {
      timeframe: "1d",
      entry: { type: "hold" },
      exit: { stop: { type: "none" }, takeProfit: null },
      universe: BTC,
      directions: LONG,
      maxOpen: 1,
    },
  },
];
export const SPOT_EXPERIMENTS = SPOT.map(make("spot"));

const F01: ExperimentConfig = {
  timeframe: "1h",
  entry: { type: "counterTrend", mode: "both" },
  exit: SCANNER_EXIT,
  universe: MOVERS,
  directions: BOTH,
  maxOpen: 5,
};
const F04: ExperimentConfig = { ...S04, directions: BOTH };
const F06: ExperimentConfig = {
  timeframe: "1h",
  entry: { type: "donchian", period: 20 },
  exit: trail(2),
  universe: TOP30,
  directions: BOTH,
  maxOpen: 5,
};

/** USDⓈ-M Futures (бессрочные) — long и short. */
const FUTURES: Entry[] = [
  {
    id: "F01",
    name: "Baseline: сканер, оба направления",
    hypothesis:
      "Контроль: как сейчас — шорт после пампа и лонг после падения, стоп и цель сканера.",
    config: F01,
  },
  {
    id: "F02",
    name: "Шорт пампа только по тренду",
    hypothesis:
      "Шорт после пампа работает, только если монета в нисходящем тренде (ниже EMA200 4h); иначе импульс продолжается.",
    config: {
      ...F01,
      entry: { type: "counterTrend", mode: "overheat" },
      directions: SHORT,
      trendFilter: EMA200_4H,
    },
  },
  {
    id: "F03",
    name: "Инверсия: лонг продолжения пампа",
    hypothesis:
      "Ночной прогон показал, что после пампа рост продолжается: входим в лонг вместо шорта, трейлинг 2 ATR.",
    config: {
      ...F01,
      entry: { type: "counterTrend", mode: "pumpContinuation" },
      exit: trail(2),
      directions: LONG,
    },
  },
  {
    id: "F04",
    name: "EMA 9/21, 15m, TP 2R",
    hypothesis:
      "Пересечение EMA 9/21 в обе стороны по тренду часа (EMA200 1h); стоп 1,5 ATR, цель 2R.",
    config: F04,
  },
  {
    id: "F05",
    name: "EMA 9/21, 15m, трейлинг",
    hypothesis: "Вход F04, выход трейлингом 3 ATR вместо фиксированной цели.",
    config: { ...F04, exit: trail(3) },
  },
  {
    id: "F06",
    name: "Donchian-20, 1h",
    hypothesis:
      "Пробой канала 20 часов вверх или вниз продолжается; трейлинг 2 ATR.",
    config: F06,
  },
  {
    id: "F07",
    name: "Donchian-55, 4h",
    hypothesis:
      "Пробой 55 свечей 4h в любую сторону — долгий тренд; трейлинг 3 ATR.",
    config: {
      ...F06,
      timeframe: "4h",
      entry: { type: "donchian", period: 55 },
      exit: trail(3),
    },
  },
  {
    id: "F08",
    name: "Supertrend на majors, всегда в рынке",
    hypothesis:
      "Supertrend(10,3) на крупных монетах: при развороте закрываем позицию и сразу открываем обратную.",
    config: {
      timeframe: "1h",
      entry: { type: "supertrend", period: 10, mult: 3 },
      exit: { stop: { type: "signal" }, takeProfit: null, exitOnSignal: true },
      universe: MAJORS_ONLY,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F09",
    name: "RSI(2) по тренду",
    hypothesis:
      "Перепроданность выше SMA200 → лонг, перекупленность ниже SMA200 → шорт; выход по SMA5 или через 10 баров.",
    config: {
      timeframe: "1h",
      entry: { type: "rsi2", threshold: 10, trendSma: 200 },
      exit: {
        stop: { type: "atr", mult: 3 },
        takeProfit: null,
        timeStopBars: 10,
        exitOnSignal: true,
      },
      universe: TOP30,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F10",
    name: "Сжатие Bollinger, оба направления",
    hypothesis:
      "После узких полос пробой в любую сторону продолжается; трейлинг 2 ATR.",
    config: {
      timeframe: "1h",
      entry: { type: "bbSqueeze", maxWidth: 0.04 },
      exit: trail(2),
      universe: TOP30,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F11",
    name: "MACD + ADX > 25",
    hypothesis:
      "MACD-сигнал только при сильном тренде (ADX > 25) отсекает пилу; цель 2R и безубыток после +1R.",
    config: {
      timeframe: "1h",
      entry: { type: "macd", minAdx: 25 },
      exit: { ...ATR15_RR2, breakevenAtR: 1 },
      universe: TOP30,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F12",
    name: "Откат к EMA20, оба направления",
    hypothesis:
      "В выстроенном тренде вверх или вниз откат к EMA20 — вход по тренду; цель 2R.",
    config: {
      timeframe: "1h",
      entry: { type: "emaPullback" },
      exit: ATR15_RR2,
      universe: TOP30,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F13",
    name: "Всплеск объёма по свече",
    hypothesis:
      "Объём ×3 — входим в сторону свечи (закрытие у high — лонг, у low — шорт); цель 1,5R, выход через 12 баров.",
    config: {
      timeframe: "1h",
      entry: { type: "volumeSpike", mult: 3 },
      exit: {
        stop: { type: "atr", mult: 1.5 },
        takeProfit: { type: "rr", r: 1.5 },
        timeStopBars: 12,
      },
      universe: TOP30,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F14",
    name: "Против перекоса funding",
    hypothesis:
      "Толпа переплачивает за лонги (funding > 0,05%) при падающей цене — шортим; funding < −0,05% при росте — лонг.",
    config: {
      timeframe: "1h",
      entry: { type: "funding", threshold: 0.0005 },
      exit: {
        stop: { type: "atr", mult: 2 },
        takeProfit: { type: "rr", r: 2 },
      },
      universe: { type: "top", n: 50 },
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F15",
    name: "Majors + Donchian-20",
    hypothesis:
      "Стратегия F06 только на крупных монетах — меньше ложных пробоев.",
    config: { ...F06, universe: MAJORS_ONLY },
  },
  {
    id: "F16",
    name: "Donchian-20 без худших монет",
    hypothesis:
      "Стратегия F06 без монет, на которых ночной прогон потерял больше всего (PIXEL, MAGIC, KAIA, BAT, Q, OP).",
    config: { ...F06, universe: { ...TOP30, blacklist: NIGHT_LOSERS } },
  },
  {
    id: "F17",
    name: "Скальп 1%/1% на 5m",
    hypothesis:
      "Пересечение EMA 9/21 на 5m с фиксированными TP 1% и SL 1% — проверяем, есть ли у быстрого входа перевес.",
    config: {
      timeframe: "5m",
      entry: { type: "emaCross", fast: 9, slow: 21 },
      exit: {
        stop: { type: "pct", pct: 1 },
        takeProfit: { type: "pct", pct: 1 },
      },
      universe: TOP30,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F18",
    name: "Тайм-стоп 4 ч без TP",
    hypothesis:
      "Вход F04, но без цели: стоп 2 ATR, выход через 4 часа — проверяем, сколько даёт само движение после сигнала.",
    config: {
      ...F04,
      exit: {
        stop: { type: "atr", mult: 2 },
        takeProfit: null,
        timeStopBars: 16,
      },
    },
  },
  {
    id: "F19",
    name: "Контроль: случайное направление",
    hypothesis:
      "Случайный вход в случайную сторону, стоп 2 ATR, цель 2R — планка для фьючерсных стратегий.",
    config: {
      timeframe: "1h",
      entry: { type: "random", probability: 0.02 },
      exit: {
        stop: { type: "atr", mult: 2 },
        takeProfit: { type: "rr", r: 2 },
      },
      universe: TOP30,
      directions: BOTH,
      maxOpen: 5,
    },
  },
  {
    id: "F20",
    name: "Контроль: long BTC 1×",
    hypothesis:
      "Постоянный лонг BTC без плеча — бенчмарк фьючерсов (с комиссией и без стопа).",
    config: {
      timeframe: "1d",
      entry: { type: "hold" },
      exit: { stop: { type: "none" }, takeProfit: null },
      universe: BTC,
      directions: LONG,
      maxOpen: 1,
    },
  },
];
export const FUTURES_EXPERIMENTS = FUTURES.map(make("futures"));

/** Каталог лаборатории: 20 spot + 20 futures. Сид в БД — upsert по id (задача 2b). */
export const EXPERIMENT_CATALOG: Experiment[] = [
  ...SPOT_EXPERIMENTS,
  ...FUTURES_EXPERIMENTS,
];
