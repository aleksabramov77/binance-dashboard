/** Экспоненциальная скользящая средняя; первые period-1 значений — NaN. */
export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI по Уайлдеру. Возвращает последнее значение (0–100) или NaN, если данных мало. */
export function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return Number.NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** ATR по Уайлдеру — средний истинный диапазон свечи. */
export function atr(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): number {
  if (candles.length <= period) return Number.NaN;
  const tr = candles.slice(1).map((c, i) => {
    const prevClose = candles[i].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  });
  let value = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++)
    value = (value * (period - 1) + tr[i]) / period;
  return value;
}
