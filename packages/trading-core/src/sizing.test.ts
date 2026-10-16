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

  it("фиксированный объём $50: риск и лимит 10% не применяются, свободные деньги — да", () => {
    expect(
      sizePosition(input({ stop: 98, fixedNotionalUsd: 50 })),
    ).toMatchObject({ notional: 50, riskUsd: 1 });
    expect(
      sizePosition(input({ stop: 98, fixedNotionalUsd: 50, availableUsd: 30 }))
        ?.notional,
    ).toBeCloseTo(30);
    expect(
      sizePosition(input({ stop: null, fixedNotionalUsd: 50 }))?.notional,
    ).toBeCloseTo(50);
  });

  describe("COIN-M: целые контракты (spec 0023)", () => {
    const coinm = (patch: Partial<SizeInput>) =>
      sizePosition(
        input({ stop: null, fixedNotionalUsd: 50, entry: 2500, ...patch }),
      );

    it("контракт $10: floor($50 / $10) = 5 контрактов, количество в монете = 5 × 10 / вход", () => {
      const s = coinm({ contractSizeUsd: 10 });
      expect(s?.notional).toBeCloseTo(50);
      expect(s?.quantity).toBeCloseTo(50 / 2500);
    });

    it("контракт BTC $100: меньше одного контракта — округляется до минимума 1 контракт", () => {
      const s = coinm({ contractSizeUsd: 100, entry: 60_000 });
      expect(s?.notional).toBeCloseTo(100);
      expect(s?.quantity).toBeCloseTo(100 / 60_000);
      expect(s?.margin).toBeCloseTo(100);
    });

    it("цена не теряет контракт на округлении: $50 / $10 = 5 при входе 5434 и 95303", () => {
      for (const entry of [5434, 95_303]) {
        const s = coinm({ contractSizeUsd: 10, entry });
        expect(s?.notional).toBeCloseTo(50);
        expect(Math.round(((s?.quantity ?? 0) * entry) / 10)).toBe(5);
      }
    });

    it("дробный остаток отбрасывается: $50 / $15 → 3 контракта", () => {
      expect(coinm({ contractSizeUsd: 15 })?.notional).toBeCloseTo(45);
    });

    it("свободных денег меньше одного контракта — не входим; хватает на часть — урезаем", () => {
      expect(coinm({ contractSizeUsd: 100, availableUsd: 60 })).toBeNull();
      expect(
        coinm({ contractSizeUsd: 10, availableUsd: 25 })?.notional,
      ).toBeCloseTo(20);
    });
  });
});
