import { describe, expect, it } from "vitest";
import { RISK_PROFILES } from "../config/profiles";
import { MAX_UNPROTECTED_SHARE, MIN_LIQUID_RESERVE } from "../config/rules";
import { buildAllocation } from "./buildAllocation";

describe("распределение по профилю риска", () => {
  it.each(
    RISK_PROFILES,
  )("%s: доли в сумме 100 %%, резерв во Flexible ≥ 10 %%", (profile) => {
    const buckets = buildAllocation(10_000, profile);
    expect(buckets.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 10);
    expect(buckets.reduce((s, b) => s + b.amountUsd, 0)).toBeCloseTo(10_000, 6);
    const flexible = buckets.find((b) => b.id === "simple-flexible");
    expect(flexible?.share).toBeGreaterThanOrEqual(MIN_LIQUID_RESERVE);
  });

  it("консервативный — без Dual, DeFi и Smart Arbitrage", () => {
    const ids = buildAllocation(1_000, "conservative").map((b) => b.id);
    expect(ids).toEqual(["simple-flexible", "simple-locked", "stable-yield"]);
  });

  it.each(
    RISK_PROFILES,
  )("%s: корзины без защиты капитала укладываются в MAX_UNPROTECTED_SHARE", (profile) => {
    const risky = buildAllocation(1_000, profile)
      .filter((b) => ["dual", "onchain", "smart-arbitrage"].includes(b.id))
      .reduce((s, b) => s + b.share, 0);
    expect(risky).toBeLessThanOrEqual(MAX_UNPROTECTED_SHARE[profile] + 1e-9);
  });

  it("лимит незащищённого капитала: 0 % / 15 % / 35 % по профилям", () => {
    expect(MAX_UNPROTECTED_SHARE).toEqual({
      conservative: 0,
      moderate: 0.15,
      aggressive: 0.35,
    });
  });

  it("отрицательная сумма считается нулём", () => {
    expect(
      buildAllocation(-5, "moderate").every((b) => b.amountUsd === 0),
    ).toBe(true);
  });
});
