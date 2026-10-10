import type { Candle } from "@binance-dashboard/trading-core";

/** Только закрытые свечи: последняя незакрытая (openTime + длина > now) отбрасывается. */
export const closedCandles = (candles: Candle[], tfMs: number, now: number) =>
  candles.filter((c) => c.openTime + tfMs <= now);

/** openTime последней закрытой свечи TF на момент now. */
export const lastClosedOpenTime = (tfMs: number, now: number) =>
  Math.floor(now / tfMs) * tfMs - tfMs;

/** Склейка кэша и свежих свечей: по openTime, свежие заменяют старые, хвост — limit штук. */
export function mergeCandles(
  cached: Candle[],
  fresh: Candle[],
  limit: number,
): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of cached) byTime.set(c.openTime, c);
  for (const c of fresh) byTime.set(c.openTime, c);
  return [...byTime.values()]
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
}

/** Кэш свечей по (market, symbol, tf). На VM живёт в памяти процесса между тиками. */
export type CandleCache = Map<string, Candle[]>;

export const candleKey = (market: string, symbol: string, tf: string) =>
  `${market}:${symbol}:${tf}`;

/**
 * Детерминированное число [0, 1) для свечи и символа (FNV-1a): контрольные «случайные»
 * эксперименты воспроизводимы, повторный тик на той же свече даёт то же решение.
 */
export function seededRandom(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}
