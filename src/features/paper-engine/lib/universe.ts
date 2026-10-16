import {
  type ExperimentMarket,
  MAJOR_BASES,
  type Universe,
} from "@binance-dashboard/trading-core";
import {
  ENGINE,
  LEVERAGED_TOKEN,
  NON_CRYPTO,
  STABLECOINS,
  SYMBOL_SUFFIX,
} from "../config/engine.ts";

/** Тикер 24 ч рынка — то, что нужно движку от Binance. */
export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  /** Изменение за 24 ч, %. */
  priceChangePercent: number;
  /** Оборот за 24 ч в $: Spot и USDⓈ-M — в котировке (USDT), COIN-M — контракты × размер контракта. */
  quoteVolume: number;
  /** COIN-M: размер контракта в $ (BTC — 100, остальные — 10) — по нему считается размер сделки. */
  contractSize?: number;
}

/** Символ группы: Spot и USDⓈ-M — BTCUSDT, COIN-M — BTCUSD_PERP (без поставочных BTCUSDT_251226). */
const SYMBOL: Record<ExperimentMarket, RegExp> = {
  spot: /^[A-Z0-9]+USDT$/,
  usdm: /^[A-Z0-9]+USDT$/,
  coinm: /^[A-Z0-9]+USD_PERP$/,
};

/**
 * Торгуемый символ группы: по шаблону символа группы (без поставочных фьючерсов), не стейбл, не плечевой
 * токен и не токенизированная акция, металл или индекс (NON_CRYPTO) — во всех группах, включая COIN-M.
 */
export function isEligibleSymbol(
  symbol: string,
  market: ExperimentMarket,
): boolean {
  if (!SYMBOL[market].test(symbol) || LEVERAGED_TOKEN.test(symbol))
    return false;
  const base = symbol.slice(0, -SYMBOL_SUFFIX[market].length);
  return !STABLECOINS.has(base) && !NON_CRYPTO.has(base);
}

/** PIXEL → PIXELUSDT (COIN-M: BTC → BTCUSD_PERP): blacklist и symbols в каталоге можно писать базой. */
export const toSymbol = (s: string, market: ExperimentMarket) => {
  const upper = s.toUpperCase();
  const suffix = SYMBOL_SUFFIX[market];
  return upper.endsWith(suffix) ? upper : `${upper}${suffix}`;
};

/**
 * Символ той же монеты в формате группы: BTCUSDT ↔ BTCUSD_PERP. Для конфигов, где символ задан одним
 * для всех групп (режим рынка marketFilter.symbol — по умолчанию BTCUSDT): у COIN-M свечи грузятся с dapi.
 */
export const symbolInMarket = (symbol: string, market: ExperimentMarket) => {
  const upper = symbol.toUpperCase();
  const own = SYMBOL_SUFFIX[market];
  if (upper.endsWith(own)) return upper;
  const other = Object.values(SYMBOL_SUFFIX).find((suffix) =>
    upper.endsWith(suffix),
  );
  return toSymbol(other ? upper.slice(0, -other.length) : upper, market);
};

/** Тикер COIN-M для движка: оборот в $ = контракты за 24 ч × размер контракта. */
export const coinmTicker = (
  t: {
    symbol: string;
    lastPrice: number;
    priceChangePercent: number;
    /** Оборот за 24 ч в контрактах. */
    volume: number;
  },
  contractSize: number,
): MarketTicker => ({
  symbol: t.symbol,
  lastPrice: t.lastPrice,
  priceChangePercent: t.priceChangePercent,
  quoteVolume: t.volume * contractSize,
  contractSize,
});

/**
 * Символы юниверса эксперимента по тикерам рынка. Тикеры фьючерсов — только бессрочные
 * контракты (фильтрует поставщик тикеров). Порядок детерминирован.
 */
export function pickUniverse(
  universe: Universe,
  tickers: MarketTicker[],
  market: ExperimentMarket,
): string[] {
  const symbol = (s: string) => toSymbol(s, market);
  const blacklist = new Set((universe.blacklist ?? []).map(symbol));
  const listed = tickers.filter(
    (t) => isEligibleSymbol(t.symbol, market) && !blacklist.has(t.symbol),
  );
  const known = new Set(listed.map((t) => t.symbol));
  const n = universe.n ?? 20;

  switch (universe.type) {
    case "majors":
      return MAJOR_BASES.map(symbol).filter((s) => known.has(s));
    case "symbols":
      return (universe.symbols ?? []).map(symbol).filter((s) => known.has(s));
    case "top":
      return [...listed]
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, n)
        .map((t) => t.symbol);
    case "movers": {
      const liquid = listed
        .filter((t) => t.quoteVolume >= ENGINE.moversMinQuoteVolume)
        .sort((a, b) => b.priceChangePercent - a.priceChangePercent);
      const gainers = liquid.slice(0, n);
      const losers = liquid.slice(Math.max(n, liquid.length - n));
      return [...gainers, ...losers].map((t) => t.symbol);
    }
  }
}
