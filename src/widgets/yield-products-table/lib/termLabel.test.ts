import { describe, expect, it } from "vitest";
import type { YieldProduct } from "@/entities/earn-product";
import { termLabel } from "./termLabel";

const base: YieldProduct = {
  id: "x",
  kind: "eth-staking",
  name: "ETH Staking",
  asset: "ETH",
  rewardAsset: null,
  apr: 0.02,
  lockDays: null,
  redemptionDays: null,
  minPurchase: null,
  quotaLeft: null,
  soldOut: false,
  priceUsd: 3_000,
};

describe("срок доходного продукта", () => {
  it("срочный, гибкий со сроком вывода, мгновенный и без данных", () => {
    expect(termLabel({ ...base, lockDays: 90 })).toBe("на 90 дн.");
    expect(termLabel({ ...base, redemptionDays: 27 })).toBe(
      "гибкий, вывод ~27 дн.",
    );
    expect(termLabel({ ...base, redemptionDays: 0 })).toBe(
      "гибкий, вывод сразу",
    );
    expect(termLabel(base)).toBe("гибкий");
  });
});
