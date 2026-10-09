import type { Mover, Setup } from "@/entities/market-signal";
import type { Candle } from "@/shared/api/binance";
import { OVERHEAT_SHORT, REBOUND_LONG, RISK_RULES } from "../config/rules";

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));
const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

/**
 * Ищет сетап по правилам:
 * - отскок после падения → LONG (Spot, если есть пара, иначе фьючерс);
 * - перегрев после роста → SHORT (только фьючерс).
 * Стоп — за экстремумом последних свечей, TP1 — возврат к EMA20, TP2 — к EMA50.
 */
export function detectSetup(mover: Mover, candles1h: Candle[]): Setup | null {
  const ind = mover.indicators;
  if (!ind || candles1h.length < RISK_RULES.swingLookback + 2) return null;

  const last = candles1h.at(-1) as Candle;
  const swing = candles1h.slice(-RISK_RULES.swingLookback);
  const entry = mover.price;
  const { atr1h: a } = ind;

  const isLong =
    mover.change24h <= REBOUND_LONG.maxChange24h &&
    ind.rsi1h <= REBOUND_LONG.maxRsi1h &&
    ind.distanceAtr <= REBOUND_LONG.maxDistanceAtr;
  const isShort =
    mover.futures &&
    mover.change24h >= OVERHEAT_SHORT.minChange24h &&
    ind.rsi1h >= OVERHEAT_SHORT.minRsi1h &&
    ind.distanceAtr >= OVERHEAT_SHORT.minDistanceAtr;
  if (!isLong && !isShort) return null;

  const direction = isLong ? "long" : "short";
  const sign = isLong ? 1 : -1;
  const extreme = isLong
    ? Math.min(...swing.map((c) => c.low))
    : Math.max(...swing.map((c) => c.high));
  const rawRisk = sign * (entry - extreme) + RISK_RULES.stopBufferAtr * a;
  const risk = clamp(
    rawRisk,
    RISK_RULES.minStopAtr * a,
    RISK_RULES.maxStopAtr * a,
  );
  const stopLoss = entry - sign * risk;

  // Цель — возврат к средним; если средняя слишком близко, берём 1,5R / 3R.
  const toEma20 = sign * (ind.ema20 - entry);
  const toEma50 = sign * (ind.ema50 - entry);
  const reward1 = toEma20 >= 0.5 * risk ? toEma20 : 1.5 * risk;
  const reward2 = Math.max(toEma50, reward1 * 1.5, 3 * risk);
  const rr = reward1 / risk;
  if (rr < RISK_RULES.minRr) return null;

  const confirmed = isLong ? last.close > last.open : last.close < last.open;
  const strength = clamp(
    ((Math.abs(ind.distanceAtr) - 2) / 4 +
      (Math.abs(ind.rsi1h - 50) - 20) / 30) /
      2,
    0,
    1,
  );

  const reasons = [
    `${isLong ? "Упал" : "Вырос"} на ${pct(Math.abs(mover.change24h))} за 24 ч`,
    `RSI 1h ${ind.rsi1h.toFixed(0)} — ${isLong ? "перепродан" : "перекуплен"} (4h: ${ind.rsi4h.toFixed(0)})`,
    `Цена в ${Math.abs(ind.distanceAtr).toFixed(1)} ATR ${isLong ? "ниже" : "выше"} EMA50`,
    ind.volumeRatio >= 1.5
      ? `Объём ×${ind.volumeRatio.toFixed(1)} к обычному`
      : `Объём обычный (×${ind.volumeRatio.toFixed(1)})`,
    confirmed
      ? `Последняя свеча ${isLong ? "зелёная" : "красная"} — первый признак разворота`
      : `Разворота пока нет — ждём ${isLong ? "зелёную" : "красную"} свечу 1h`,
  ];

  return {
    id: `${mover.symbol}:${direction}`,
    symbol: mover.symbol,
    base: mover.base,
    kind: isLong ? "rebound-long" : "overheat-short",
    direction,
    market: isLong && mover.spot ? "spot" : "futures",
    status: confirmed ? "ready" : "watch",
    entry,
    stopLoss,
    takeProfit1: entry + sign * reward1,
    takeProfit2: entry + sign * reward2,
    rr,
    strength,
    reasons,
    change24h: mover.change24h,
    quoteVolumeUsd: mover.quoteVolumeUsd,
    indicators: ind,
  };
}
