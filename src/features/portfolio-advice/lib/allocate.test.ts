import { describe, expect, it } from "vitest";
import { allocate, offerSegments } from "./allocate";
import { offer } from "./fixtures";

const u = offer({
  id: "U001:flexible:0",
  asset: "U",
  baseApr: 0.01,
  maxApr: 0.07,
  tiers: [{ from: 0, to: 8000, bonusApr: 0.06 }],
});
const usdc = offer({
  id: "USDC001:flexible:0",
  asset: "USDC",
  baseApr: 0.0287,
  maxApr: 0.0487,
  tiers: [{ from: 0, to: 10000, bonusApr: 0.02 }],
});
const usd1 = offer({
  id: "USD1001:flexible:0",
  asset: "USD1",
  baseApr: 0.0394,
  maxApr: 0.0394,
});

describe("offerSegments", () => {
  it("режет продукт на бонусную ступень и базу до лимита", () => {
    const segments = offerSegments({ ...usdc, maxPerUser: 50000 });
    expect(segments).toEqual([
      { rate: 0.0487, capacityUsd: 10000 },
      { rate: 0.0287, capacityUsd: 40000 },
    ]);
  });
});

describe("allocate", () => {
  it("заполняет бонусные ступени по убыванию ставки, остаток — в лучшую базу", () => {
    const result = allocate(30000, [u, usdc, usd1]);
    const byAsset = Object.fromEntries(
      result.allocations.map((a) => [a.offer.asset, a.amountUsd]),
    );
    expect(byAsset).toEqual({ U: 8000, USDC: 10000, USD1: 12000 });
    expect(result.incomeUsd).toBeCloseTo(
      8000 * 0.07 + 10000 * 0.0487 + 12000 * 0.0394,
    );
    expect(result.marginalApr).toBeCloseTo(0.0394);
  });

  it("на маленькую сумму всё идёт в самую высокую ступень", () => {
    const result = allocate(1000, [u, usdc, usd1]);
    expect(result.allocations.map((a) => a.offer.asset)).toEqual(["U"]);
    expect(result.incomeUsd).toBeCloseTo(70);
  });

  it("сообщает о неразмещённом остатке, если кончились лимиты", () => {
    const result = allocate(1500, [
      offer({ id: "X", asset: "USDT", maxPerUser: 1000 }),
    ]);
    expect(result.unallocatedUsd).toBeCloseTo(500);
  });
});
