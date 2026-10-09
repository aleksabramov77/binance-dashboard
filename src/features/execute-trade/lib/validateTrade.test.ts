import { describe, expect, it } from "vitest";
import type { TradeRequest } from "@/entities/trade";
import {
  floorToStep,
  roundToTick,
  stepDecimals,
  validateTrade,
} from "./validateTrade";

const rules = {
  tickSize: "0.01000000",
  stepSize: "0.00100000",
  minQty: 0.001,
  minNotional: 5,
};

const long: TradeRequest = {
  symbol: "ETHUSDT",
  market: "spot",
  direction: "long",
  quantity: 0.0257,
  stopLoss: 1900.123,
  takeProfit: 2100.456,
  leverage: 1,
};

describe("округление по правилам биржи", () => {
  it("считает знаки шага и округляет количество вниз", () => {
    expect(stepDecimals("0.00100000")).toBe(3);
    expect(stepDecimals("1")).toBe(0);
    expect(floorToStep(0.0257, "0.00100000")).toBe("0.025");
    expect(floorToStep(1697.999, "1")).toBe("1697");
  });

  it("округляет цену к ближайшему тику", () => {
    expect(roundToTick(1900.126, "0.01")).toBe("1900.13");
    expect(roundToTick(0.0623819, "0.000001")).toBe("0.062382");
  });
});

describe("validateTrade", () => {
  it("пропускает корректный лонг и округляет уровни", () => {
    const result = validateTrade(long, 2000, rules, 1000);
    expect(result).toEqual({
      ok: true,
      value: {
        quantity: "0.025",
        stopLoss: "1900.12",
        takeProfit: "2100.46",
        notionalUsd: 50,
      },
    });
  });

  it("отклоняет шорт на споте и плечо на споте", () => {
    const result = validateTrade(
      {
        ...long,
        direction: "short",
        leverage: 2,
        stopLoss: 2100,
        takeProfit: 1900,
      },
      2000,
      rules,
      1000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it("отклоняет устаревшие уровни, если цена ушла за стоп", () => {
    expect(validateTrade(long, 1850, rules, 1000).ok).toBe(false);
  });

  it("держит объём между минимумом символа и лимитом на сделку", () => {
    expect(
      validateTrade({ ...long, quantity: 0.001 }, 2000, rules, 1000).ok,
    ).toBe(false);
    expect(validateTrade({ ...long, quantity: 1 }, 2000, rules, 1000).ok).toBe(
      false,
    );
  });
});
