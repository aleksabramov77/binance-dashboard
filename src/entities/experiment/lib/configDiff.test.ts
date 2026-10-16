import type { ExperimentConfig } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { diffExperimentConfig } from "./configDiff";

const base: ExperimentConfig = {
  timeframe: "1h",
  entry: { type: "donchian", period: 20 },
  exit: { stop: { type: "atr", mult: 2 }, takeProfit: { type: "rr", r: 2 } },
  universe: { type: "top", n: 30, blacklist: ["AAAUSDT"] },
  directions: ["long", "short"],
  maxOpen: 5,
};

const control = { market: "usdm" as const, config: base };

describe("diffExperimentConfig", () => {
  it("без отличий — пустой список («настройки совпадают»)", () => {
    expect(
      diffExperimentConfig(control, {
        market: "usdm",
        config: structuredClone(base),
      }),
    ).toEqual([]);
  });

  it("вложенные поля — по пути до значения", () => {
    expect(
      diffExperimentConfig(control, {
        market: "usdm",
        config: {
          ...base,
          exit: { ...base.exit, takeProfit: { type: "rr", r: 3 } },
        },
      }),
    ).toEqual([{ path: "exit.takeProfit.r", control: "2", variant: "3" }]);
  });

  it("массивы сравниваются целиком; группа активов — строкой market", () => {
    expect(
      diffExperimentConfig(control, {
        market: "spot",
        config: {
          ...base,
          directions: ["long"],
          universe: { ...base.universe, blacklist: ["AAAUSDT", "BBBUSDT"] },
        },
      }),
    ).toEqual([
      { path: "market", control: "usdm", variant: "spot" },
      {
        path: "universe.blacklist",
        control: "AAAUSDT",
        variant: "AAAUSDT, BBBUSDT",
      },
      { path: "directions", control: "long, short", variant: "long" },
    ]);
  });

  it("добавленные и удалённые ключи — с пустой стороной", () => {
    const { n: _n, ...universe } = base.universe;
    expect(
      diffExperimentConfig(control, {
        market: "usdm",
        config: {
          ...base,
          universe,
          exit: { ...base.exit, trailAtr: 2.5 },
          marketFilter: {
            symbol: "BTCUSDT",
            timeframe: "4h",
            ema: 200,
            long: "above",
            short: "any",
          },
        },
      }),
    ).toEqual([
      { path: "exit.trailAtr", control: null, variant: "2.5" },
      { path: "universe.n", control: "30", variant: null },
      {
        path: "marketFilter",
        control: null,
        variant:
          '{"symbol":"BTCUSDT","timeframe":"4h","ema":200,"long":"above","short":"any"}',
      },
    ]);
  });

  it("смена типа входа — отличающиеся поля обоих вариантов союза", () => {
    expect(
      diffExperimentConfig(control, {
        market: "usdm",
        config: {
          ...base,
          entry: { type: "rsi2", threshold: 10, trendSma: 200 },
        },
      }),
    ).toEqual([
      { path: "entry.type", control: "donchian", variant: "rsi2" },
      { path: "entry.period", control: "20", variant: null },
      { path: "entry.threshold", control: null, variant: "10" },
      { path: "entry.trendSma", control: null, variant: "200" },
    ]);
  });
});
