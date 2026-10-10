/** Параметры тика движка экспериментов (spec 003). */
export const ENGINE = {
  /** Свечей TF сигнала: хватает на EMA/SMA 200 с прогревом. */
  signalCandles: 300,
  /** Свечей при дозагрузке, когда кэш уже есть (новые свечи + перекрытие). */
  refreshCandles: 10,
  /** Максимум 1m-свечей за один запрос Binance (больший разрыв дочитается следующими тиками). */
  maxMinuteCandles: 1000,
  /** Одновременных запросов к Binance — бережём rate limit. */
  concurrency: 8,
  /** Минимальный оборот за 24 ч для movers — отсекаем неликвид. */
  moversMinQuoteVolume: 20_000_000,
  /** Объём каждой paper-сделки, USD (решение пользователя 2026-10-10). */
  tradeNotionalUsd: 50,
  /** Плечо paper-фьючерсов: маржа = объём. */
  futuresLeverage: 1,
  /**
   * Окно свежести сигнала: вход — только если свеча TF закрылась не раньше max(3 мин, 5% TF) назад
   * (5m/15m/1h — 3 мин, 4h — 12 мин, 1d — 72 мин). 3 мин = интервал тика + запас.
   */
  minSignalAgeMs: 3 * 60_000,
  signalAgeShare: 0.05,
  /** Длина ATR для стопов и трейлинга. */
  atrPeriod: 14,
} as const;

/** Котировка юниверса. */
export const QUOTE = "USDT";

/** Плечевые токены Binance — не торгуем. */
export const LEVERAGED_TOKEN = /(UP|DOWN|BULL|BEAR)USDT$/;

/**
 * Стейблкоины (база ≈ 1 USD) — исключаем из юниверса. Копия списка shared/config/stablecoins:
 * модуль движка не импортирует @/… — его исходники исполняет и Deno (Edge Function Supabase).
 */
export const STABLECOINS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "USDP",
  "DAI",
  "BFUSD",
  "USD1",
  "RLUSD",
  "PYUSD",
  "USDE",
  "USDS",
  "XUSD",
  "U",
  "BUSD",
  "EUR",
  "EURI",
  "AEUR",
]);
