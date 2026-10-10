import { describe, expect, it } from "vitest";
import { entryFill, exitFill, settle, unrealizedPnl } from "./fills.ts";

describe("entryFill / exitFill", () => {
  it("вход по рынку хуже цены на 0,05%", () => {
    expect(entryFill(100, "long")).toBeCloseTo(100.05);
    expect(entryFill(100, "short")).toBeCloseTo(99.95);
  });

  it("тейк — по уровню, остальные выходы — с проскальзыванием", () => {
    expect(exitFill(104, "long", "tp")).toBe(104);
    expect(exitFill(98, "long", "sl")).toBeCloseTo(97.951);
    expect(exitFill(102, "short", "trail")).toBeCloseTo(102.051);
  });
});

describe("settle", () => {
  it("spot long: комиссия 0,1% с обеих сторон и R от исходного стопа", () => {
    const s = settle({
      market: "spot",
      direction: "long",
      entryPrice: 100,
      exitPrice: 110,
      quantity: 1,
      initialStop: 95,
    });
    expect(s.fees).toBeCloseTo(0.21);
    expect(s.pnl).toBeCloseTo(9.79);
    expect(s.rMultiple).toBeCloseTo(1.958);
  });

  it("futures short: комиссия 0,05%, прибыль при падении", () => {
    const s = settle({
      market: "futures",
      direction: "short",
      entryPrice: 100,
      exitPrice: 90,
      quantity: 2,
      initialStop: 105,
    });
    expect(s.fees).toBeCloseTo(0.19);
    expect(s.pnl).toBeCloseTo(19.81);
    expect(s.rMultiple).toBeCloseTo(19.81 / 10);
  });

  it("убыток на стопе ≈ −1R минус комиссии; без стопа R не определён", () => {
    const loss = settle({
      market: "futures",
      direction: "long",
      entryPrice: 100,
      exitPrice: 98,
      quantity: 1,
      initialStop: 98,
    });
    expect(loss.rMultiple).toBeCloseTo(-1.0495);
    expect(
      settle({
        market: "spot",
        direction: "long",
        entryPrice: 100,
        exitPrice: 101,
        quantity: 1,
        initialStop: null,
      }).rMultiple,
    ).toBeNull();
  });
});

describe("unrealizedPnl", () => {
  it("учитывает комиссии входа и будущего выхода", () => {
    expect(
      unrealizedPnl(
        { market: "spot", direction: "long", entryPrice: 100, quantity: 1 },
        105,
      ),
    ).toBeCloseTo(4.795);
  });
});
