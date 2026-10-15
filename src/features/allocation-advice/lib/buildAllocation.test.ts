import { describe, expect, it } from "vitest";
import { RISK_PROFILES } from "../config/profiles";
import { MIN_LIQUID_RESERVE } from "../config/rules";
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

  it("незащищённый капитал в агрессивном — не больше трети суммы", () => {
    const risky = buildAllocation(1_000, "aggressive")
      .filter((b) => ["dual", "onchain", "smart-arbitrage"].includes(b.id))
      .reduce((s, b) => s + b.share, 0);
    expect(risky).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  it("отрицательная сумма считается нулём", () => {
    expect(
      buildAllocation(-5, "moderate").every((b) => b.amountUsd === 0),
    ).toBe(true);
  });
});
