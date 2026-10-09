import { describe, expect, it } from "vitest";
import type { Offer } from "../model/schema";
import { evaluateOffer } from "./yield";

const usdc: Offer = {
  id: "USDC001:flexible:0",
  asset: "USDC",
  type: "flexible",
  durationDays: 0,
  maxApr: 0.05,
  baseApr: 0.03,
  tiers: [{ from: 0, to: 1000, bonusApr: 0.02 }],
  minPurchase: 0.01,
  maxPerUser: null,
  soldOut: false,
  stablecoin: true,
  priceUsd: 1,
};

describe("evaluateOffer", () => {
  it("даёт полную ставку, пока сумма в пределах бонусной ступени", () => {
    expect(evaluateOffer(usdc, 500)?.effectiveApr).toBeCloseTo(0.05);
  });

  it("смешивает бонус и базовую ставку выше лимита", () => {
    // 1000 × 5% + 1000 × 3% = 80 → 4% на 2000
    const y = evaluateOffer(usdc, 2000);
    expect(y?.yearlyIncomeUsd).toBeCloseTo(80);
    expect(y?.effectiveApr).toBeCloseTo(0.04);
    expect(y?.bonusCapUsd).toBe(1000);
  });

  it("пересчитывает USD в единицы актива по цене", () => {
    const bnb: Offer = {
      ...usdc,
      asset: "BNB",
      priceUsd: 500,
      tiers: [{ from: 0, to: 1, bonusApr: 0.02 }],
    };
    // 1000$ = 2 BNB: 1 BNB по 5%, 1 BNB по 3%
    expect(evaluateOffer(bnb, 1000)?.effectiveApr).toBeCloseTo(0.04);
    expect(evaluateOffer(bnb, 1000)?.bonusCapUsd).toBe(500);
  });

  it("не начисляет доход сверх лимита на пользователя", () => {
    const capped: Offer = {
      ...usdc,
      tiers: [],
      maxApr: 0.03,
      maxPerUser: 1000,
    };
    expect(evaluateOffer(capped, 2000)?.yearlyIncomeUsd).toBeCloseTo(30);
  });

  it("помечает суммы ниже минимума и пропускает активы без цены", () => {
    expect(evaluateOffer({ ...usdc, minPurchase: 100 }, 50)?.belowMinimum).toBe(
      true,
    );
    expect(evaluateOffer({ ...usdc, priceUsd: null }, 50)).toBeNull();
  });
});
