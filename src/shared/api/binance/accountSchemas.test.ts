import { describe, expect, it } from "vitest";
import { flexibleRewardsSchema, lockedRewardsSchema } from "./accountSchemas";

describe("flexibleRewardsSchema", () => {
  it("разбирает ответ как на пробе: суммы строками, id продукта в productId", () => {
    const parsed = flexibleRewardsSchema.parse({
      total: 2,
      rows: [
        {
          asset: "USDT",
          rewards: "0.07023246",
          productId: "USDT001",
          type: "REALTIME",
          time: 1792022399000,
        },
        {
          asset: "USDT",
          rewards: "0.05479",
          productId: "USDT001",
          type: "BONUS",
          time: 1791953007000,
        },
      ],
    });
    expect(parsed.rows[0]).toEqual({
      asset: "USDT",
      rewards: 0.07023246,
      productId: "USDT001",
      type: "REALTIME",
      time: 1792022399000,
    });
  });

  it("берёт id продукта из projectId, как в примере документации", () => {
    const parsed = flexibleRewardsSchema.parse({
      total: 1,
      rows: [
        {
          asset: "BUSD",
          rewards: "0.00006408",
          projectId: "USDT001",
          type: "BONUS",
          time: 1577233578000,
        },
      ],
    });
    expect(parsed.rows[0]?.productId).toBe("USDT001");
  });
});

describe("lockedRewardsSchema", () => {
  it("positionId числом приводит к строке, сумму — к числу", () => {
    const parsed = lockedRewardsSchema.parse({
      total: 1,
      rows: [
        {
          positionId: 123123,
          time: 1575018510000,
          asset: "BNB",
          lockPeriod: "30",
          amount: "21312.23223",
          type: "Locked Rewards",
        },
      ],
    });
    expect(parsed.rows[0]).toEqual({
      positionId: "123123",
      time: 1575018510000,
      asset: "BNB",
      amount: 21312.23223,
      type: "Locked Rewards",
    });
  });
});
