import { describe, expect, it } from "vitest";
import { aprWithTiers } from "./tierApr";

describe("aprWithTiers", () => {
  it("добавляет бонус только на часть суммы внутри ступени", () => {
    expect(aprWithTiers(0.03, { "0-1000USDC": 0.02 }, 2000)).toBeCloseTo(0.04);
    expect(aprWithTiers(0.03, { "0-1000USDC": 0.02 }, 500)).toBeCloseTo(0.05);
    expect(aprWithTiers(0.03, null, 500)).toBe(0.03);
  });
});
