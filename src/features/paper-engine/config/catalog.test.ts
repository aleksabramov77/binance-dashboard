import { experimentSchema } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_CATALOG,
  FUTURES_EXPERIMENTS,
  SPOT_EXPERIMENTS,
} from "./catalog.ts";

const ids = (prefix: string) =>
  Array.from(
    { length: 20 },
    (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`,
  );

describe("каталог экспериментов", () => {
  it("каждый эксперимент проходит схему ядра", () => {
    for (const e of EXPERIMENT_CATALOG)
      expect(experimentSchema.parse(e)).toEqual(e);
  });

  it("20 spot (S01–S20) и 20 futures (F01–F20), id уникальны", () => {
    expect(SPOT_EXPERIMENTS.map((e) => e.id)).toEqual(ids("S"));
    expect(FUTURES_EXPERIMENTS.map((e) => e.id)).toEqual(ids("F"));
    expect(SPOT_EXPERIMENTS.every((e) => e.market === "spot")).toBe(true);
    expect(FUTURES_EXPERIMENTS.every((e) => e.market === "futures")).toBe(true);
    expect(new Set(EXPERIMENT_CATALOG.map((e) => e.id)).size).toBe(40);
  });

  it("spot — только long, бюджет 10 000, у каждого есть суть", () => {
    for (const e of SPOT_EXPERIMENTS)
      expect(e.config.directions).toEqual(["long"]);
    for (const e of EXPERIMENT_CATALOG) {
      expect(e.initialBudget).toBe(10_000);
      expect(e.hypothesis.length).toBeGreaterThan(20);
    }
  });

  it("TP по R:R только со стопом", () => {
    for (const e of EXPERIMENT_CATALOG)
      if (e.config.exit.takeProfit?.type === "rr")
        expect(e.config.exit.stop.type).not.toBe("none");
  });
});
