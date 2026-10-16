import { describe, expect, it } from "vitest";
import {
  computeEntryContext,
  ENTRY_CONTEXT_VERSION,
  type EntryContextInput,
} from "./context.ts";
import { TIMEFRAME_MS } from "./experiment.ts";
import { ema } from "./indicators/basic.ts";
import { adxSeries, atrSeries, bollinger, rsiSeries } from "./indicators/ta.ts";
import type { Candle } from "./types.ts";

const H1 = TIMEFRAME_MS["1h"];
const H4 = TIMEFRAME_MS["4h"];
// Вторник 2026-10-13 15:00 UTC; первая 1h-свеча ряда — за 300 часов до входа.
const AT = Date.parse("2026-10-13T15:00:00Z");

/** Ряд закрытых к AT свечей: close растёт на step, high/low ±1, объём 10 (последняя — volumeLast). */
function series(
  n: number,
  tfMs: number,
  opts: { start?: number; step?: number; volumeLast?: number } = {},
): Candle[] {
  const { start = 100, step = 0.5, volumeLast = 10 } = opts;
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return {
      openTime: AT - (n - i) * tfMs,
      open: close - step,
      high: close + 1,
      low: close - 1,
      close,
      volume: i === n - 1 ? volumeLast : 10,
    };
  });
}

const input = (patch: Partial<EntryContextInput> = {}): EntryContextInput => ({
  at: AT,
  timeframe: "1h",
  candles: series(300, H1, { volumeLast: 25 }),
  btc4h: series(300, H4, { start: 60_000, step: 10 }),
  funding: 0.00012,
  universeRank: 3,
  universeSize: 20,
  ...patch,
});

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

describe("computeEntryContext", () => {
  it("каждое поле — по закрытой свече сигнала", () => {
    const { candles } = input();
    const closes = candles.map((c) => c.close);
    const last = candles[candles.length - 1];
    const ctx = computeEntryContext(input());
    expect(ctx.v).toBe(ENTRY_CONTEXT_VERSION);
    expect(ctx.atrPct).toBe(
      round4(((atrSeries(candles, 14).at(-1) ?? 0) / last.close) * 100),
    );
    expect(ctx.adx14).toBe(round4(adxSeries(candles, 14).at(-1) ?? 0));
    expect(ctx.bbWidthPct).toBe(
      round4((bollinger(closes, 20, 2).width.at(-1) ?? 0) * 100),
    );
    expect(ctx.rsi14).toBe(round4(rsiSeries(closes, 14).at(-1) ?? 0));
    expect(ctx.volumeRatio).toBe(2.5); // 25 к средней 10 предыдущих 20 свечей
    expect(ctx.ema200DistPct).toBe(
      round4((last.close / (ema(closes, 200).at(-1) ?? 1) - 1) * 100),
    );
    // 24 свечи 1h назад close был на 24 × 0,5 = 12 ниже.
    expect(ctx.change24hPct).toBe(
      round4((last.close / (last.close - 12) - 1) * 100),
    );
    expect(ctx.universeRank).toBe(3);
    expect(ctx.universeSize).toBe(20);
    expect(ctx.btcAboveEma200_4h).toBe(true);
    expect(ctx.btcAdx14_4h).toBeGreaterThan(25);
    // 24 ч = 6 свечей 4h по 10.
    const btcLast = 60_000 + 299 * 10;
    expect(ctx.btcChange24hPct).toBe(
      round4((btcLast / (btcLast - 60) - 1) * 100),
    );
    expect(ctx.funding).toBe(0.00012);
    expect(ctx.hourUtc).toBe(15);
    expect(ctx.weekday).toBe(2);
  });

  it("не заглядывает вперёд: незакрытые к моменту входа свечи не влияют", () => {
    const base = computeEntryContext(input());
    const spike = (openTime: number, close: number): Candle => ({
      openTime,
      open: close,
      high: close * 2,
      low: close / 2,
      close,
      volume: 1e9,
    });
    const withFuture = computeEntryContext(
      input({
        candles: [...input().candles, spike(AT, 10_000), spike(AT + H1, 1)],
        btc4h: [...(input().btc4h ?? []), spike(AT - H4 + H1, 1)],
      }),
    );
    expect(withFuture).toEqual(base);
  });

  it("падение BTC ниже EMA200 — режим ниже", () => {
    const ctx = computeEntryContext(
      input({ btc4h: series(300, H4, { start: 90_000, step: -10 }) }),
    );
    expect(ctx.btcAboveEma200_4h).toBe(false);
    expect(ctx.btcChange24hPct).toBeLessThan(0);
  });

  it("нехватка истории — null у тех полей, которым её не хватило", () => {
    const short = computeEntryContext(
      input({
        candles: series(16, H1),
        btc4h: series(50, H4),
        funding: null,
        universeRank: null,
        universeSize: null,
      }),
    );
    expect(short.atrPct).not.toBeNull(); // ATR(14) — 15 свечей
    expect(short.rsi14).not.toBeNull(); // RSI(14) — 15 свечей
    expect(short.adx14).toBeNull(); // ADX(14) — 28 свечей
    expect(short.bbWidthPct).toBeNull(); // Bollinger(20) — 20 свечей
    expect(short.volumeRatio).toBeNull(); // SMA20 предыдущих — 21 свеча
    expect(short.ema200DistPct).toBeNull(); // EMA200 — 200 свечей
    expect(short.change24hPct).toBeNull(); // нет свечи 24 ч назад
    expect(short.btcAboveEma200_4h).toBeNull();
    expect(short.btcAdx14_4h).not.toBeNull();
    expect(short.funding).toBeNull();
    expect(short.universeRank).toBeNull();
    expect(short.hourUtc).toBe(15);
  });

  it("нет свечей и BTC не загрузился — все рыночные поля null, время есть", () => {
    const ctx = computeEntryContext(input({ candles: [], btc4h: null }));
    expect(ctx).toMatchObject({
      atrPct: null,
      adx14: null,
      rsi14: null,
      change24hPct: null,
      btcAboveEma200_4h: null,
      btcAdx14_4h: null,
      btcChange24hPct: null,
      hourUtc: 15,
      weekday: 2,
    });
  });

  it("дневной ТФ: изменение за 24 ч — к предыдущей дневной свече", () => {
    const ctx = computeEntryContext(
      input({
        timeframe: "1d",
        candles: series(30, TIMEFRAME_MS["1d"], { step: 2 }),
      }),
    );
    const last = 100 + 29 * 2;
    expect(ctx.change24hPct).toBe(round4((last / (last - 2) - 1) * 100));
  });
});
