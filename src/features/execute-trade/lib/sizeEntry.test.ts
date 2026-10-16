import { describe, expect, it } from "vitest";
import { sizeEntry } from "./sizeEntry";

const rules = (minNotional: number, stepSize = "0.001", minQty = 0.001) => ({
  minNotional,
  stepSize,
  minQty,
});

describe("sizeEntry: объём реального входа", () => {
  it("$10 — округление вниз по шагу, без подъёма", () => {
    const r = sizeEntry({
      price: 3,
      rules: rules(5, "0.1", 0.1),
      targetUsd: 10,
      maxUsd: 50,
      spotStop: null,
    });
    expect(r).toEqual({
      ok: true,
      quantity: 3.3,
      notionalUsd: 3.3 * 3,
      raised: false,
    });
  });

  it("минимум биржи выше $10 — объём поднимается до минимума с запасом 1%", () => {
    const r = sizeEntry({
      price: 2000,
      rules: rules(20),
      targetUsd: 10,
      maxUsd: 50,
      spotStop: null,
    });
    expect(r).toMatchObject({ ok: true, quantity: 0.011, raised: true });
    if (r.ok) expect(r.notionalUsd).toBeCloseTo(22, 5);
  });

  it("минимум ровно $50 — вход на минимум, запас 1% не выводит за $50", () => {
    const r = sizeEntry({
      price: 100_000,
      rules: rules(50, "0.0001", 0.0001),
      targetUsd: 10,
      maxUsd: 50,
      spotStop: null,
    });
    expect(r).toMatchObject({ ok: true, quantity: 0.0005, raised: true });
    if (r.ok) expect(r.notionalUsd).toBeLessThanOrEqual(50);
  });

  it("минимум выше $50 — пропуск с минимумом биржи", () => {
    expect(
      sizeEntry({
        price: 100_000,
        rules: rules(100),
        targetUsd: 10,
        maxUsd: 50,
        spotStop: null,
      }),
    ).toEqual({ ok: false, minUsd: 100 });
    // minQty × цена тоже минимум: 0,001 BTC × 100 000 = $100.
    expect(
      sizeEntry({
        price: 100_000,
        rules: rules(5),
        targetUsd: 10,
        maxUsd: 50,
        spotStop: null,
      }),
    ).toMatchObject({ ok: false, minUsd: 100 });
  });

  it("спот: стоп после комиссии должен пройти минимум — объём поднимается", () => {
    const r = sizeEntry({
      price: 1,
      rules: rules(5, "1", 1),
      targetUsd: 10,
      maxUsd: 50,
      spotStop: 0.4,
    });
    // Стоп продаст (q × 0,999 → вниз к шагу) × 0,4 ≥ $5 → q ≥ 13.
    expect(r).toMatchObject({ ok: true, raised: true });
    if (r.ok)
      expect(Math.floor(r.quantity * 0.999) * 0.4).toBeGreaterThanOrEqual(5);
  });
});
