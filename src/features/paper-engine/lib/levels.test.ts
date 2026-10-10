import type { ExitRule } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { computeLevels } from "./levels";

const signal = { direction: "long" as const, meta: {} };

describe("уровни стопа и тейка", () => {
  it("ATR-стоп и TP по R:R для long и short", () => {
    const exit: ExitRule = {
      stop: { type: "atr", mult: 2 },
      takeProfit: { type: "rr", r: 2 },
    };
    expect(computeLevels(exit, signal, "long", 100, 1)).toEqual({
      stop: 98,
      takeProfit: 104,
    });
    expect(computeLevels(exit, signal, "short", 100, 1)).toEqual({
      stop: 102,
      takeProfit: 96,
    });
  });

  it("pct — в процентах от входа", () => {
    const exit: ExitRule = {
      stop: { type: "pct", pct: 1 },
      takeProfit: { type: "pct", pct: 1 },
    };
    expect(computeLevels(exit, signal, "short", 100, 1)).toEqual({
      stop: 101,
      takeProfit: 99,
    });
  });

  it("уровни сигнала по неверную сторону цены — не входим", () => {
    const exit: ExitRule = {
      stop: { type: "signal" },
      takeProfit: { type: "signal" },
    };
    expect(
      computeLevels(
        exit,
        { ...signal, stop: 101, target: 110 },
        "long",
        100,
        1,
      ),
    ).toBeNull();
    expect(
      computeLevels(exit, { ...signal, stop: 95, target: 99 }, "long", 100, 1),
    ).toBeNull();
    expect(
      computeLevels(exit, { ...signal, stop: 95, target: 110 }, "long", 100, 1),
    ).toEqual({ stop: 95, takeProfit: 110 });
  });

  it("без стопа и без TP — buy & hold; R:R без стопа невозможен", () => {
    expect(
      computeLevels(
        { stop: { type: "none" }, takeProfit: null },
        signal,
        "long",
        100,
        1,
      ),
    ).toEqual({ stop: null, takeProfit: null });
    expect(
      computeLevels(
        { stop: { type: "none" }, takeProfit: { type: "rr", r: 2 } },
        signal,
        "long",
        100,
        1,
      ),
    ).toBeNull();
  });
});
