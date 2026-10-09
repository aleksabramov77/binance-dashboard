import { describe, expect, it } from "vitest";
import type { Setup } from "@/entities/market-signal";
import { sizePosition } from "./sizePosition";

const setup: Setup = {
  id: "X:long",
  symbol: "XUSDT",
  base: "X",
  kind: "rebound-long",
  direction: "long",
  market: "futures",
  status: "ready",
  entry: 100,
  stopLoss: 95,
  takeProfit1: 110,
  takeProfit2: 120,
  rr: 2,
  strength: 0.5,
  reasons: [],
  change24h: -0.1,
};

describe("sizePosition", () => {
  it("подбирает объём так, чтобы стоп стоил ровно риск", () => {
    // риск 1% от 1000 = 10$, стоп 5$ на единицу → 2 единицы
    const size = sizePosition(setup, {
      capital: 1000,
      riskPct: 0.01,
      maxNotional: 10_000,
      leverage: 2,
    });
    expect(size.quantity).toBeCloseTo(2);
    expect(size.lossAtStopUsd).toBeCloseTo(10);
    expect(size.profitAtTp1Usd).toBeCloseTo(20);
    expect(size.marginUsd).toBeCloseTo(100);
    expect(size.cappedByLimit).toBe(false);
  });

  it("урезает объём лимитом на сделку", () => {
    const size = sizePosition(setup, {
      capital: 1000,
      riskPct: 0.01,
      maxNotional: 50,
      leverage: 2,
    });
    expect(size.notionalUsd).toBeCloseTo(50);
    expect(size.lossAtStopUsd).toBeCloseTo(2.5);
    expect(size.cappedByLimit).toBe(true);
  });

  it("не даёт плечо выше 3x и не применяет плечо к Spot", () => {
    const settings = {
      capital: 1000,
      riskPct: 0.01,
      maxNotional: 10_000,
      leverage: 10,
    };
    expect(sizePosition(setup, settings).leverage).toBe(3);
    expect(sizePosition({ ...setup, market: "spot" }, settings).leverage).toBe(
      1,
    );
  });
});
