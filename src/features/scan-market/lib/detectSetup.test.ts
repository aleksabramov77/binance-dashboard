import { describe, expect, it } from "vitest";
import type { Indicators, Mover } from "@/entities/market-signal";
import type { Candle } from "@/shared/api/binance";
import { detectSetup } from "./detectSetup";

const candle = (
  low: number,
  high: number,
  open: number,
  close: number,
): Candle => ({
  openTime: 0,
  open,
  high,
  low,
  close,
  volume: 1,
});

const flat = (n: number, low: number, high: number) =>
  Array.from({ length: n }, () => candle(low, high, low + 1, low + 1));

const mover = (patch: Partial<Mover>, ind: Partial<Indicators>): Mover => ({
  symbol: "XUSDT",
  base: "X",
  spot: true,
  futures: true,
  price: 100,
  change24h: -0.1,
  quoteVolumeUsd: 1e8,
  ...patch,
  indicators: {
    rsi1h: 25,
    rsi4h: 35,
    atr1h: 2,
    ema20: 106,
    ema50: 110,
    volumeRatio: 2,
    distanceAtr: -5,
    ...ind,
  },
});

describe("detectSetup", () => {
  it("находит отскок после падения: стоп под минимумом, TP1 у EMA20", () => {
    const candles = [...flat(20, 97, 103), candle(98, 101, 99, 100)];
    const setup = detectSetup(mover({}, {}), candles);
    expect(setup).toMatchObject({
      direction: "long",
      market: "spot",
      status: "ready",
    });
    // минимум 97 − 0,25 ATR (0,5) = 96,5 → риск 3,5
    expect(setup?.stopLoss).toBeCloseTo(96.5);
    expect(setup?.takeProfit1).toBeCloseTo(106);
    expect(setup?.takeProfit2).toBeCloseTo(110.5);
    expect(setup?.rr).toBeCloseTo(6 / 3.5);
  });

  it("помечает сетап как watch, пока нет разворотной свечи", () => {
    const candles = [...flat(20, 97, 103), candle(98, 101, 101, 100)];
    expect(detectSetup(mover({}, {}), candles)?.status).toBe("watch");
  });

  it("шорт после памп-а только при наличии фьючерса", () => {
    const candles = [...flat(20, 97, 103), candle(99, 102, 101, 100)];
    const pumped = { change24h: 0.3 };
    const ind = { rsi1h: 80, distanceAtr: 4, ema20: 94, ema50: 90 };
    const short = detectSetup(mover(pumped, ind), candles);
    expect(short).toMatchObject({ direction: "short", market: "usdm" });
    expect(short?.stopLoss).toBeCloseTo(103.5);
    expect(
      detectSetup(mover({ ...pumped, futures: false }, ind), candles),
    ).toBeNull();
  });

  it("ограничивает стоп диапазоном 0,8–3 ATR", () => {
    const deep = [...flat(20, 80, 103), candle(98, 101, 99, 100)];
    expect(detectSetup(mover({}, { ema20: 115 }), deep)?.stopLoss).toBeCloseTo(
      94,
    );
  });

  it("пропускает обычные движения и сетапы с плохим R:R", () => {
    const candles = [...flat(20, 97, 103), candle(98, 101, 99, 100)];
    expect(detectSetup(mover({ change24h: -0.03 }, {}), candles)).toBeNull();
    expect(detectSetup(mover({}, { rsi1h: 45 }), candles)).toBeNull();
  });
});
