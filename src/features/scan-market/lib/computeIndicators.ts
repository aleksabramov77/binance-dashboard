import type { Indicators } from "@/entities/market-signal";
import type { Candle } from "@/shared/api/binance";
import { atr, ema, rsi } from "@/shared/lib";

/** Индикаторы по свечам 1h (≥ 60 шт.) и 4h. null — если данных мало. */
export function computeIndicators(
  candles1h: Candle[],
  candles4h: Candle[],
): Indicators | null {
  if (candles1h.length < 60 || candles4h.length < 20) return null;
  const closes = candles1h.map((c) => c.close);
  const price = closes.at(-1) ?? 0;
  const atr1h = atr(candles1h);
  const ema20 = ema(closes, 20).at(-1) ?? Number.NaN;
  const ema50 = ema(closes, 50).at(-1) ?? Number.NaN;

  const volumes = candles1h.map((c) => c.volume);
  const recent = volumes.slice(-3).reduce((s, v) => s + v, 0) / 3;
  const baseline = volumes.slice(-27, -3).reduce((s, v) => s + v, 0) / 24;

  const indicators: Indicators = {
    rsi1h: rsi(closes),
    rsi4h: rsi(candles4h.map((c) => c.close)),
    atr1h,
    ema20,
    ema50,
    volumeRatio: baseline > 0 ? recent / baseline : 1,
    distanceAtr: atr1h > 0 ? (price - ema50) / atr1h : 0,
  };
  return Object.values(indicators).every(Number.isFinite) ? indicators : null;
}
