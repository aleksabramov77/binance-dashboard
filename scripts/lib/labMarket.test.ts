import { describe, expect, it } from "vitest";
import type { Candle } from "@/shared/api/binance/market";
import {
  computeMarketContext,
  D1,
  describeMarket,
  describeRegime,
  H4,
  type MarketContext,
  regimeOf,
} from "./labMarket";

const T0 = Date.parse("2026-07-01T00:00:00Z");

/** Свечи 4h с ценой по функции от индекса; последняя — незакрытая на момент now. */
function h4(n: number, price: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const open = price(i);
    const close = price(i + 1);
    return {
      openTime: T0 + i * H4,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 1,
    };
  });
}

function d1(n: number, price: (day: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: T0 + i * D1,
    open: price(i),
    high: Math.max(price(i), price(i + 1)),
    low: Math.min(price(i), price(i + 1)),
    close: price(i + 1),
    volume: 1,
  }));
}

const market = (over: Partial<MarketContext>): MarketContext => ({
  symbol: "BTCUSDT",
  lastPrice: 100,
  periodReturnPct: -3.21,
  periodMaxDrawdownPct: 0.051,
  ema200_4h: 105,
  aboveEma200: false,
  adx14_4h: 18.4,
  atrPct14_4h: 1.234,
  regime: "range",
  regimeAtStart: "range",
  daily: [],
  ...over,
});

describe("regimeOf", () => {
  it("тренд по ADX ≥ 25, флэт < 20, между — дрейф", () => {
    expect(regimeOf(true, 30)).toBe("trend-up");
    expect(regimeOf(false, 25)).toBe("trend-down");
    expect(regimeOf(true, 19)).toBe("range");
    expect(regimeOf(true, 22)).toBe("drift-up");
    expect(regimeOf(false, 22)).toBe("drift-down");
    expect(regimeOf(null, 30)).toBe("unknown");
  });
});

describe("computeMarketContext", () => {
  it("устойчивый рост: выше EMA200, тренд вверх и на старте, и сейчас; доходность и просадка за период", () => {
    const n = 300;
    const candles = h4(n, (i) => 100 * 1.003 ** i);
    const now = candles[n - 1].openTime + H4 / 2; // последняя свеча ещё идёт
    const periodStart = candles[n - 60].openTime + 1000; // попадает в свечу n-60
    const ctx = computeMarketContext({
      symbol: "BTCUSDT",
      h4: candles,
      d1: d1(50, (d) => 100 * 1.018 ** d),
      periodStart,
      now,
    });
    expect(ctx.aboveEma200).toBe(true);
    expect(ctx.adx14_4h).not.toBeNull();
    expect(ctx.regime).toBe("trend-up");
    expect(ctx.regimeAtStart).toBe("trend-up");
    expect(ctx.periodReturnPct).toBeCloseTo((1.003 ** 60 - 1) * 100, 5);
    expect(ctx.periodMaxDrawdownPct).toBe(0);
    expect(ctx.atrPct14_4h).toBeGreaterThan(0);
    // дни периода: с начала UTC-дня periodStart до now
    const firstDay = Math.floor(periodStart / D1) * D1;
    expect(ctx.daily[0].date).toBe(
      new Date(firstDay).toISOString().slice(0, 10),
    );
    expect(ctx.daily.at(-1)?.returnPct).toBeCloseTo(1.8, 5);
  });

  it("на старте периода данных на EMA200 ещё нет — режим «не определён», сейчас — тренд", () => {
    const n = 260;
    const candles = h4(n, (i) => 100 * 1.003 ** i);
    const ctx = computeMarketContext({
      symbol: "BTCUSDT",
      h4: candles,
      d1: [],
      periodStart: candles[100].openTime, // к этому моменту закрыто 100 свечей
      now: candles[n - 1].openTime + H4,
    });
    expect(ctx.regimeAtStart).toBe("unknown");
    expect(ctx.regime).toBe("trend-up");
    expect(describeRegime(ctx)).toBe("режим сейчас: тренд вверх");
  });

  it("период раньше первой свечи — доходность не считается; мало свечей — EMA200 нет", () => {
    const candles = h4(50, () => 100);
    const ctx = computeMarketContext({
      symbol: "BTCUSDT",
      h4: candles,
      d1: [],
      periodStart: T0 - D1,
      now: candles[49].openTime + H4,
    });
    expect(ctx.periodReturnPct).toBeNull();
    expect(ctx.ema200_4h).toBeNull();
    expect(ctx.regime).toBe("unknown");
    expect(ctx.daily).toEqual([]);
  });

  it("падение с отскоком: просадка по закрытиям от пика", () => {
    const path = [100, 110, 120, 90, 95, 99];
    const candles = h4(
      path.length - 1,
      (i) => path[Math.min(i, path.length - 1)],
    );
    const ctx = computeMarketContext({
      symbol: "BTCUSDT",
      h4: candles,
      d1: [],
      periodStart: T0,
      now: candles[candles.length - 1].openTime + H4,
    });
    expect(ctx.periodReturnPct).toBeCloseTo(-1, 5);
    expect(ctx.periodMaxDrawdownPct).toBeCloseTo(0.25, 5);
  });
});

describe("describeMarket / describeRegime", () => {
  it("одной строкой, без смены режима", () => {
    expect(describeMarket(market({}))).toBe(
      "BTCUSDT: за период -3.2%, просадка 5.1%, цена ниже EMA200 4h, ADX(14) 4h 18, ATR 1.23% → режим за период: флэт (без смены).",
    );
  });
  it("смена режима показывается стрелкой", () => {
    expect(
      describeRegime(market({ regimeAtStart: "trend-up", regime: "range" })),
    ).toBe("режим за период: тренд вверх → флэт");
  });
});
