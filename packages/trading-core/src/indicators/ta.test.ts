import { describe, expect, it } from "vitest";
import { rsi } from "./basic";
import {
  adxSeries,
  atrSeries,
  bollinger,
  donchian,
  macd,
  type Ohlc,
  rsiSeries,
  smaSeries,
  supertrend,
} from "./ta";

const bar = (close: number, range = 1): Ohlc => ({
  open: close,
  high: close + range / 2,
  low: close - range / 2,
  close,
  volume: 1,
});
const rising = (n: number) => Array.from({ length: n }, (_, i) => bar(100 + i));
const falling = (n: number) =>
  Array.from({ length: n }, (_, i) => bar(200 - i));

describe("smaSeries", () => {
  it("считает среднее окна", () => {
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual([Number.NaN, 1.5, 2.5, 3.5]);
  });
});

describe("rsiSeries", () => {
  it("последнее значение совпадает с rsi()", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
    expect(rsiSeries(closes).at(-1)).toBeCloseTo(rsi(closes), 8);
    expect(rsiSeries(closes)[13]).toBeNaN();
  });
});

describe("atrSeries", () => {
  it("равен диапазону одинаковых свечей", () => {
    const c = Array.from({ length: 30 }, () => bar(100, 2));
    expect(atrSeries(c).at(-1)).toBeCloseTo(2);
  });
});

describe("bollinger", () => {
  it("на постоянном ряду полосы сходятся в среднюю", () => {
    const b = bollinger(new Array(25).fill(10));
    expect(b.upper.at(-1)).toBe(10);
    expect(b.width.at(-1)).toBe(0);
  });
});

describe("macd", () => {
  it("на росте линия выше нуля", () => {
    const m = macd(rising(80).map((c) => c.close));
    expect(m.line.at(-1)).toBeGreaterThan(0);
    expect(Number.isFinite(m.signal.at(-1))).toBe(true);
  });
});

describe("adxSeries", () => {
  it("сильный тренд даёт высокий ADX", () => {
    expect(adxSeries(rising(80)).at(-1)).toBeGreaterThan(50);
  });
});

describe("supertrend", () => {
  it("вверх на росте, вниз на падении", () => {
    expect(supertrend(rising(60)).dir.at(-1)).toBe(1);
    expect(supertrend([...rising(30), ...falling(60)]).dir.at(-1)).toBe(-1);
  });
});

describe("donchian", () => {
  it("канал по предыдущим свечам без текущей", () => {
    const d = donchian(rising(25), 20);
    expect(d.upper[19]).toBeNaN();
    expect(d.upper.at(-1)).toBe(123.5);
    expect(d.lower.at(-1)).toBe(103.5);
  });
});
