import { MAJORS, type Universe } from "@binance-dashboard/trading-core";
import {
  ENGINE,
  LEVERAGED_TOKEN,
  QUOTE,
  STABLECOINS,
} from "../config/engine.ts";

/** Тикер 24 ч рынка — то, что нужно движку от Binance. */
export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  /** Изменение за 24 ч, %. */
  priceChangePercent: number;
  /** Оборот за 24 ч в котировке (USDT). */
  quoteVolume: number;
}

const SYMBOL = /^[A-Z0-9]+USDT$/;

/** Торгуемый символ: только …USDT (без поставочных фьючерсов вида BTCUSDT_251226), не стейбл и не плечевой токен. */
export function isEligibleSymbol(symbol: string): boolean {
  if (!SYMBOL.test(symbol) || LEVERAGED_TOKEN.test(symbol)) return false;
  return !STABLECOINS.has(symbol.slice(0, -QUOTE.length));
}

/** PIXEL → PIXELUSDT: blacklist и symbols в каталоге можно писать базой. */
export const toSymbol = (s: string) => {
  const upper = s.toUpperCase();
  return upper.endsWith(QUOTE) ? upper : `${upper}${QUOTE}`;
};

/**
 * Символы юниверса эксперимента по тикерам рынка. Тикеры futures — только бессрочные
 * контракты (фильтрует поставщик тикеров). Порядок детерминирован.
 */
export function pickUniverse(
  universe: Universe,
  tickers: MarketTicker[],
): string[] {
  const blacklist = new Set((universe.blacklist ?? []).map(toSymbol));
  const listed = tickers.filter(
    (t) => isEligibleSymbol(t.symbol) && !blacklist.has(t.symbol),
  );
  const known = new Set(listed.map((t) => t.symbol));
  const n = universe.n ?? 20;

  switch (universe.type) {
    case "majors":
      return MAJORS.filter((s) => known.has(s));
    case "symbols":
      return (universe.symbols ?? []).map(toSymbol).filter((s) => known.has(s));
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
