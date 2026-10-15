import { describe, expect, it } from "vitest";
import { type Holding, plannedIncomeUsd } from "./schema";

const holding = (patch: Partial<Holding>): Holding => ({
  asset: "USDT",
  place: "flexible",
  amount: 1000,
  frozen: 0,
  priceUsd: 1,
  apr: 0.0365,
  productId: "USDT001",
  positionId: null,
  durationDays: null,
  until: null,
  yesterdayUsd: null,
  ...patch,
});

describe("plannedIncomeUsd", () => {
  it("день = USD × ставка / 365, месяц = / 12, год = USD × ставка", () => {
    const h = holding({});
    expect(plannedIncomeUsd(h, "day")).toBeCloseTo(0.1);
    expect(plannedIncomeUsd(h, "month")).toBeCloseTo(3.041667, 5);
    expect(plannedIncomeUsd(h, "year")).toBeCloseTo(36.5);
  });

  it("учитывает замороженное (Locked) и цену монеты", () => {
    const h = holding({
      asset: "BNB",
      place: "locked",
      amount: 0,
      frozen: 2,
      priceUsd: 600,
      apr: 0.1,
    });
    expect(plannedIncomeUsd(h, "year")).toBeCloseTo(120);
  });

  it("без ставки (Spot/Funding) — 0", () => {
    expect(plannedIncomeUsd(holding({ place: "spot", apr: 0 }), "day")).toBe(0);
  });

  it("цена неизвестна — null", () => {
    expect(plannedIncomeUsd(holding({ priceUsd: null }), "month")).toBeNull();
  });
});
