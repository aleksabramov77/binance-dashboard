import { describe, expect, it } from "vitest";
import { buildPlan } from "./buildPlan";
import { holding, offer } from "./fixtures";

const usdt = offer({
  id: "USDT001:flexible:0",
  asset: "USDT",
  baseApr: 0.025,
  maxApr: 0.025,
});
const usdc = offer({
  id: "USDC001:flexible:0",
  asset: "USDC",
  baseApr: 0.0287,
  maxApr: 0.0487,
  tiers: [{ from: 0, to: 10000, bonusApr: 0.02 }],
});

describe("buildPlan", () => {
  it("советует перевести USDT со Spot в USDC Flexible через обмен", () => {
    const [plan] = buildPlan(
      [holding({ asset: "USDT", place: "spot", amount: 5000 })],
      [usdt, usdc],
    );
    expect(plan.label).toBe("Стейблкоины");
    expect(plan.currentIncomeUsd).toBe(0);
    expect(plan.targetIncomeUsd).toBeCloseTo(5000 * 0.0487);
    expect(plan.moves).toEqual([
      expect.objectContaining({
        fromAsset: "USDT",
        fromPlace: "spot",
        to: usdc,
        amountUsd: 5000,
        needsSwap: true,
      }),
    ]);
  });

  it("не трогает то, что уже лежит в нужном продукте", () => {
    const holdings = [
      holding({
        asset: "USDC",
        place: "flexible",
        amount: 3000,
        apr: 0.0487,
        productId: "USDC001",
      }),
      holding({ asset: "USDC", place: "funding", amount: 2000 }),
    ];
    const [plan] = buildPlan(holdings, [usdt, usdc]);
    expect(plan.moves).toEqual([
      expect.objectContaining({
        fromAsset: "USDC",
        fromPlace: "funding",
        amountUsd: 2000,
        needsSwap: false,
      }),
    ]);
  });

  it("не предлагает ходов, если выигрыш копеечный", () => {
    const holdings = [
      holding({
        asset: "USDC",
        place: "flexible",
        amount: 3000,
        apr: 0.0487,
        productId: "USDC001",
      }),
    ];
    expect(buildPlan(holdings, [usdt, usdc])[0].moves).toEqual([]);
  });

  it("показывает Locked, только если он заметно выгоднее Flexible", () => {
    const locked = offer({
      id: "L:locked:30",
      asset: "USDT",
      type: "locked",
      durationDays: 30,
      baseApr: 0.08,
      maxApr: 0.08,
    });
    const [plan] = buildPlan(
      [holding({ asset: "USDT", place: "spot", amount: 20000 })],
      [usdt, usdc, locked],
    );
    expect(plan.locked?.offer.id).toBe("L:locked:30");
    expect(plan.locked?.extraIncomeUsd).toBeCloseTo(
      20000 * 0.08 - (10000 * 0.0487 + 10000 * 0.0287),
    );
  });

  it("для нестейблкоинов сравнивает только продукты той же монеты", () => {
    const btc = offer({
      id: "BTC001:flexible:0",
      asset: "BTC",
      priceUsd: 100000,
      baseApr: 0.001,
      maxApr: 0.001,
    });
    const plans = buildPlan(
      [holding({ asset: "BTC", place: "spot", amount: 0.1, priceUsd: 100000 })],
      [usdc, btc],
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].allocations.map((a) => a.offer.asset)).toEqual(["BTC"]);
  });
});
