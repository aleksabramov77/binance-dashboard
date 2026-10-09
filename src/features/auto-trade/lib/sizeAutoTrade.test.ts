import { describe, expect, it } from "vitest";
import { sizeAutoTrade } from "./sizeAutoTrade";

const rules = { riskPct: 0.01, maxNotionalUsd: 100, leverage: 2 };

describe("sizeAutoTrade", () => {
  it("риск 1% кошелька, если объём в лимите", () => {
    // 1% от 1000 = 10 $, стоп 1 $ на монету → 10 монет по 5 $ = 50 $.
    const s = sizeAutoTrade(
      { entry: 5, stopLoss: 6, market: "futures" },
      1000,
      rules,
    );
    expect(s).toEqual({ quantity: 10, leverage: 2 });
  });

  it("объём урезается до maxNotional", () => {
    const s = sizeAutoTrade(
      { entry: 100, stopLoss: 99, market: "futures" },
      5000,
      rules,
    );
    expect(s?.quantity).toBeCloseTo(1);
  });

  it("spot — плечо 1 и объём не больше кошелька", () => {
    const s = sizeAutoTrade(
      { entry: 10, stopLoss: 9, market: "spot" },
      40,
      rules,
    );
    expect(s?.leverage).toBe(1);
    expect((s?.quantity ?? 0) * 10).toBeLessThanOrEqual(40);
  });

  it("пустой кошелёк или нулевой стоп — null", () => {
    expect(
      sizeAutoTrade({ entry: 1, stopLoss: 1, market: "futures" }, 100, rules),
    ).toBeNull();
    expect(
      sizeAutoTrade({ entry: 1, stopLoss: 2, market: "futures" }, 0, rules),
    ).toBeNull();
  });
});
