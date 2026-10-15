import { describe, expect, it } from "vitest";
import type { DualOffer } from "../model/schema";
import {
  distanceToStrike,
  dualReturn,
  dualScenarios,
  evaluateDual,
} from "./dual";

const base: DualOffer = {
  id: "dual:1",
  side: "sell-high",
  coin: "BTC",
  stable: "USDT",
  strikePrice: 72_000,
  apr: 0.365,
  durationDays: 10,
  settleAt: "2026-10-25T08:00:00.000Z",
  purchaseEndAt: "2026-10-24T08:00:00.000Z",
  minAmount: 0.0001,
  maxAmount: 10,
  canPurchase: true,
  price: 70_000,
};
const buyLow: DualOffer = {
  ...base,
  side: "buy-low",
  strikePrice: 68_000,
  minAmount: 10,
  maxAmount: 1_000_000,
};

describe("аналитика Dual Investment", () => {
  it("расстояние до страйка: выше цены — плюс, ниже — минус, без цены — null", () => {
    expect(distanceToStrike(72_000, 70_000)).toBeCloseTo(0.02857, 4);
    expect(distanceToStrike(68_000, 70_000)).toBeCloseTo(-0.02857, 4);
    expect(distanceToStrike(68_000, null)).toBeNull();
  });

  it("доход за срок = APR × дни / 365", () => {
    expect(dualReturn(base)).toBeCloseTo(0.01, 10);
  });

  it("Sell High: исполнение — стейбл по страйку плюс доход, иначе монета плюс доход", () => {
    const s = dualScenarios(base, 7_000);
    expect(s?.invest).toEqual({ asset: "BTC", amount: 0.1 });
    expect(s?.exercised.asset).toBe("USDT");
    expect(s?.exercised.amount).toBeCloseTo(7_272, 6);
    expect(s?.notExercised.asset).toBe("BTC");
    expect(s?.notExercised.amount).toBeCloseTo(0.101, 10);
    expect(s?.effectivePrice).toBeCloseTo(72_720, 6);
  });

  it("Buy Low: исполнение — монета по страйку с доходом, иначе стейбл плюс доход", () => {
    const s = dualScenarios(buyLow, 6_800);
    expect(s?.invest).toEqual({ asset: "USDT", amount: 6_800 });
    expect(s?.exercised.asset).toBe("BTC");
    expect(s?.exercised.amount).toBeCloseTo(0.101, 10);
    expect(s?.notExercised).toEqual({ asset: "USDT", amount: 6_868 });
    expect(s?.effectivePrice).toBeCloseTo(68_000 / 1.01, 6);
  });

  it("доход в $ и лимиты покупки", () => {
    const e = evaluateDual(buyLow, 5);
    expect(e?.incomeUsd).toBeCloseTo(0.05, 10);
    expect(e?.belowMinimum).toBe(true);
    expect(evaluateDual(base, 7_000_000)?.aboveMaximum).toBe(true);
  });

  it("сумма ≤ 0 или Sell High без цены — null", () => {
    expect(evaluateDual(base, 0)).toBeNull();
    expect(evaluateDual(base, -1)).toBeNull();
    expect(evaluateDual({ ...base, price: null }, 1_000)).toBeNull();
    expect(dualScenarios(base, 0)).toBeNull();
  });
});
