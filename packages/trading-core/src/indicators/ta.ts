// Индикаторы теханализа рядом: значение на каждой свече (NaN, пока данных мало).
// Нужны стратегиям экспериментов — им важны пересечения, то есть прошлые значения.
import { ema } from "./basic.ts";

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const nan = (n: number) => new Array<number>(n).fill(Number.NaN);

/** Простая скользящая средняя. */
export function smaSeries(values: number[], period: number): number[] {
  const out = nan(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Сглаживание Уайлдера (RMA): старт — SMA первых period значений. */
function rma(values: number[], period: number, start = 0): number[] {
  const out = nan(values.length);
  if (values.length - start < period) return out;
  let prev = 0;
  for (let i = start; i < start + period; i++) prev += values[i];
  prev /= period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** RSI по Уайлдеру на каждой свече. */
export function rsiSeries(closes: number[], period = 14): number[] {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const g = rma(gains, period, 1);
  const l = rma(losses, period, 1);
  return g.map((gv, i) => {
    if (Number.isNaN(gv)) return Number.NaN;
    if (l[i] === 0) return 100;
    return 100 - 100 / (1 + gv / l[i]);
  });
}

function trueRanges(c: Ohlc[]): number[] {
  return c.map((x, i) =>
    i === 0
      ? x.high - x.low
      : Math.max(
          x.high - x.low,
          Math.abs(x.high - c[i - 1].close),
          Math.abs(x.low - c[i - 1].close),
        ),
  );
}

/** ATR по Уайлдеру на каждой свече. */
export function atrSeries(candles: Ohlc[], period = 14): number[] {
  return rma(trueRanges(candles), period, 1);
}

/** Полосы Боллинджера: средняя ± k·σ и ширина (upper − lower) / middle. */
export function bollinger(closes: number[], period = 20, k = 2) {
  const middle = smaSeries(closes, period);
  const upper = nan(closes.length);
  const lower = nan(closes.length);
  const width = nan(closes.length);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const sd = Math.sqrt(
      slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period,
    );
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
    width[i] = mean > 0 ? (upper[i] - lower[i]) / mean : Number.NaN;
  }
  return { middle, upper, lower, width };
}

/** MACD: линия (EMA fast − EMA slow), сигнальная (EMA signal от линии) и гистограмма. */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const sig = nan(closes.length);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid), signal);
    tail.forEach((v, j) => {
      sig[firstValid + j] = v;
    });
  }
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, hist };
}

/** ADX (сила тренда, 0–100) по Уайлдеру. */
export function adxSeries(c: Ohlc[], period = 14): number[] {
  const plusDm = [0];
  const minusDm = [0];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const tr = rma(trueRanges(c), period, 1);
  const pdm = rma(plusDm, period, 1);
  const mdm = rma(minusDm, period, 1);
  const dx = tr.map((t, i) => {
    if (Number.isNaN(t) || t === 0) return Number.NaN;
    const pdi = (100 * pdm[i]) / t;
    const mdi = (100 * mdm[i]) / t;
    return pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
  });
  const start = dx.findIndex((v) => !Number.isNaN(v));
  return start < 0 ? nan(c.length) : rma(dx, period, start);
}

/** Supertrend: линия и направление (1 — вверх, −1 — вниз) на каждой свече. */
export function supertrend(c: Ohlc[], period = 10, mult = 3) {
  const a = atrSeries(c, period);
  const line = nan(c.length);
  const dir = new Array<number>(c.length).fill(0);
  let upper = Number.NaN;
  let lower = Number.NaN;
  for (let i = 0; i < c.length; i++) {
    if (Number.isNaN(a[i])) continue;
    const mid = (c[i].high + c[i].low) / 2;
    const bu = mid + mult * a[i];
    const bl = mid - mult * a[i];
    const prevClose = i > 0 ? c[i - 1].close : c[i].close;
    upper = Number.isNaN(upper) || bu < upper || prevClose > upper ? bu : upper;
    lower = Number.isNaN(lower) || bl > lower || prevClose < lower ? bl : lower;
    const prevDir = dir[i - 1] || 1;
    let d = prevDir;
    if (prevDir === -1 && c[i].close > upper) d = 1;
    else if (prevDir === 1 && c[i].close < lower) d = -1;
    dir[i] = d;
    line[i] = d === 1 ? lower : upper;
  }
  return { line, dir };
}

/** Канал Дончиана по предыдущим period свечам (без текущей). */
export function donchian(c: Ohlc[], period = 20) {
  const upper = nan(c.length);
  const lower = nan(c.length);
  for (let i = period; i < c.length; i++) {
    const w = c.slice(i - period, i);
    upper[i] = Math.max(...w.map((x) => x.high));
    lower[i] = Math.min(...w.map((x) => x.low));
  }
  return { upper, lower };
}
