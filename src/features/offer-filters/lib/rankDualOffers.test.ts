import { describe, expect, it } from "vitest";
import type { Offer } from "@/entities/earn-offer";
import type { DualOffer } from "@/entities/earn-product";
import type { DualFilters } from "../model/useDualFilters";
import { rankDualOffers } from "./rankDualOffers";

const dual = (o: Partial<DualOffer>): DualOffer => ({
  id: "dual:1",
  side: "buy-low",
  coin: "BTC",
  stable: "USDT",
  strikePrice: 76_000,
  apr: 0.3,
  durationDays: 7,
  settleAt: "2026-10-22T08:00:00.000Z",
  purchaseEndAt: "2026-10-21T08:00:00.000Z",
  minAmount: 10,
  maxAmount: 1_000_000,
  canPurchase: true,
  price: 80_000,
  ...o,
});

const flexible = (asset: string, apr: number): Offer => ({
  id: `${asset}:flexible`,
  asset,
  type: "flexible",
  durationDays: 0,
  maxApr: apr,
  baseApr: apr,
  tiers: [],
  minPurchase: null,
  maxPerUser: null,
  soldOut: false,
  stablecoin: asset === "USDT",
  priceUsd: asset === "USDT" ? 1 : 80_000,
});

const filters: DualFilters = {
  amount: 1_000,
  dcoin: "",
  side: "all",
  maxDays: 30,
  minDist: 0,
};

const offers = [
  dual({ id: "near", strikePrice: 79_000, apr: 0.8 }),
  dual({ id: "far", strikePrice: 72_000, apr: 0.2 }),
  dual({ id: "sell", side: "sell-high", strikePrice: 84_000, apr: 0.4 }),
  dual({ id: "long", durationDays: 60, apr: 0.9 }),
  dual({ id: "eth", coin: "ETH", price: 3_000, strikePrice: 2_800 }),
  dual({ id: "closed", canPurchase: false, apr: 5 }),
];
const simple = [flexible("USDT", 0.05), flexible("BTC", 0.01)];
const ids = (f: Partial<DualFilters>) =>
  rankDualOffers(offers, simple, { ...filters, ...f }).map((r) => r.offer.id);

describe("ранжирование Dual", () => {
  it("скрывает закрытые и дольше maxDays; сортирует по превышению над Flexible", () => {
    expect(ids({})).toEqual(["near", "sell", "eth", "far"]);
    expect(ids({ maxDays: 0 })).toContain("long");
  });

  it("Flexible берётся по вкладываемому активу: Buy Low — стейбл, Sell High — монета", () => {
    const ranked = rankDualOffers(offers, simple, filters);
    const near = ranked.find((r) => r.offer.id === "near");
    const sell = ranked.find((r) => r.offer.id === "sell");
    expect(near?.flexibleApr).toBe(0.05);
    expect(near?.edge).toBeCloseTo(0.75, 10);
    expect(sell?.flexibleApr).toBe(0.01);
  });

  it("фильтры монеты, направления и минимального расстояния до страйка", () => {
    expect(ids({ dcoin: "eth" })).toEqual(["eth"]);
    expect(ids({ side: "sell-high" })).toEqual(["sell"]);
    // near — 1,25 % от цены, sell — 5 %, far — 10 %, eth — 6,7 %.
    expect(ids({ minDist: 5 })).toEqual(["sell", "eth", "far"]);
  });

  it("без снимка Simple Earn сравнения нет — порядок по APR", () => {
    const ranked = rankDualOffers(offers, [], filters);
    expect(ranked[0].edge).toBeNull();
    expect(ranked.map((r) => r.offer.id)).toEqual([
      "near",
      "sell",
      "eth",
      "far",
    ]);
  });
});
