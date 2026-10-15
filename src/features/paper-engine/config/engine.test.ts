import {
  type MarketFilter,
  REGIME_MAX_EMA,
  regimeMinCandles,
} from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { ENGINE } from "./engine.ts";

describe("параметры движка", () => {
  it("история свечей покрывает самый длинный фильтр режима рынка (spec 0029)", () => {
    const longest: MarketFilter = {
      symbol: "BTCUSDT",
      timeframe: "1d",
      ema: REGIME_MAX_EMA,
      minAdx: 30,
      long: "above",
      short: "below",
    };
    expect(ENGINE.signalCandles).toBeGreaterThanOrEqual(
      regimeMinCandles(longest),
    );
  });
});
