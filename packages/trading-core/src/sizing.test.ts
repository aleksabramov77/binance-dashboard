import { describe, expect, it } from "vitest";
import { type SizeInput, sizePosition } from "./sizing.ts";

const input = (patch: Partial<SizeInput> = {}): SizeInput => ({
  entry: 100,
  stop: 50,
  initialBudget: 10_000,
  availableUsd: 10_000,
  leverage: 1,
  ...patch,
});

describe("sizePosition", () => {
  it("широкий стоп: объём от риска 0,5% стартового бюджета", () => {
    // риск $50, $50 на единицу → 1 шт.
    expect(sizePosition(input())).toEqual({
      quantity: 1,
      notional: 100,
      riskUsd: 50,
      margin: 100,
    });
  });

  it("узкий стоп: объём урезан до 10% бюджета, риск меньше 0,5%", () => {
    const s = sizePosition(input({ stop: 98 }));
    expect(s?.notional).toBeCloseTo(1000);
    expect(s?.riskUsd).toBeCloseTo(20);
  });

  it("не больше свободных денег; плечо увеличивает доступный объём", () => {
    expect(
      sizePosition(input({ stop: 98, availableUsd: 300 }))?.notional,
    ).toBeCloseTo(300);
    const fut = sizePosition(
      input({ stop: 98, availableUsd: 300, leverage: 3 }),
    );
    expect(fut?.notional).toBeCloseTo(900);
    expect(fut?.margin).toBeCloseTo(300);
  });

  it("без стопа — объём по лимиту, риск не определён", () => {
    expect(sizePosition(input({ stop: null }))).toMatchObject({
      notional: 1000,
      riskUsd: null,
    });
  });

  it("стоп на цене входа, нет денег или объём меньше минимума — null", () => {
    expect(sizePosition(input({ stop: 100 }))).toBeNull();
    expect(sizePosition(input({ availableUsd: 0 }))).toBeNull();
    expect(sizePosition(input({ stop: 98, availableUsd: 2 }))).toBeNull();
  });
});
