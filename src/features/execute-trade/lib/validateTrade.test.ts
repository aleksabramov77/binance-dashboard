import { describe, expect, it } from "vitest";
import type { TradeRequest } from "@/entities/trade";
import {
  floorToStep,
  isDust,
  roundToTick,
  stepDecimals,
  type TradeContext,
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

const ctx = (patch: Partial<TradeContext> = {}): TradeContext => ({
  price: 2000,
  rules,
  maxNotionalUsd: 1000,
  availableUsd: 5000,
  maxRiskPct: 0.02,
  ...patch,
});

describe("validateTrade", () => {
  it("пропускает корректный лонг и округляет уровни", () => {
    const result = validateTrade(long, ctx());
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
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it("отклоняет устаревшие уровни, если цена ушла за стоп", () => {
    expect(validateTrade(long, ctx({ price: 1850 })).ok).toBe(false);
  });

  it("держит объём между минимумом символа и лимитом на сделку", () => {
    expect(validateTrade({ ...long, quantity: 0.001 }, ctx()).ok).toBe(false);
    expect(validateTrade({ ...long, quantity: 1 }, ctx()).ok).toBe(false);
  });

  it("сразу говорит, что кошелёк пуст, не дожидаясь отказа биржи", () => {
    const futures = { ...long, market: "futures" as const, leverage: 2 };
    const result = validateTrade(futures, ctx({ availableUsd: 0 }));
    expect(result).toEqual({
      ok: false,
      errors: [
        "На демо-кошельке USDⓈ-M Futures 0 USDT — пополните его на demo.binance.com.",
      ],
    });
  });

  it("не даёт потерять на стопе больше 2% баланса кошелька", () => {
    // 0.025 ETH × ~$100 до стопа ≈ $2,50 потери; 2% от $100 = $2
    const result = validateTrade(long, ctx({ availableUsd: 100 }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]).toContain("больше 2% баланса Spot ($2.00)");
  });

  it("проверяет, хватает ли маржи с учётом плеча", () => {
    const futures = {
      ...long,
      market: "futures" as const,
      leverage: 2,
      quantity: 0.4,
      stopLoss: 1990,
    };
    // объём $800 / ×2 = $400 маржи, свободно $300
    const result = validateTrade(futures, ctx({ availableUsd: 300 }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContain(
        "Нужно $400.00 маржи, а на USDⓈ-M Futures свободно $300.00.",
      );
  });
});

describe("isDust", () => {
  const rules = { minQty: 0.1, minNotional: 5 };
  it("хвост дешевле минимального ордера — пыль", () => {
    expect(isDust(0.1, 5.7, rules)).toBe(true);
  });
  it("меньше minQty или ноль — пыль", () => {
    expect(isDust(0.05, 1000, rules)).toBe(true);
    expect(isDust(0, 5, rules)).toBe(true);
  });
  it("нормальный остаток продаём", () => {
    expect(isDust(8.6, 5.7, rules)).toBe(false);
  });
});
