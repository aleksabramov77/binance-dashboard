import { describe, expect, it } from "vitest";
import { futuresOrderSchema } from "./demoSchemas";

describe("futuresOrderSchema", () => {
  it("принимает ответ демо-фьючерсов без avgPrice (реальный случай 2026-10-09)", () => {
    const parsed = futuresOrderSchema.parse({
      symbol: "USUSDT",
      orderId: 333094984,
      status: "NEW",
      executedQty: "0",
    });
    expect(parsed).toMatchObject({
      orderId: 333094984,
      avgPrice: 0,
      executedQty: 0,
    });
  });

  it("читает числа-строки, когда они есть", () => {
    const parsed = futuresOrderSchema.parse({
      symbol: "USUSDT",
      orderId: 1,
      status: "FILLED",
      executedQty: "3080",
      avgPrice: "0.0324130",
    });
    expect(parsed.avgPrice).toBeCloseTo(0.032413);
    expect(parsed.executedQty).toBe(3080);
  });
});
