import { describe, expect, it } from "vitest";
import type { TradeRequest } from "@/entities/trade";
import {
  fitSpotStopToMinNotional,
  fitToMinNotional,
  fitToPriceBand,
  floorToStep,
  isDust,
  roundToTick,
  spotSellQuantity,
  spotStopNotional,
  stepDecimals,
  type TradeContext,
  validateTrade,
} from "./validateTrade";

const rules = {
  tickSize: "0.01000000",
  stepSize: "0.00100000",
  minQty: 0.001,
  minNotional: 5,
  priceBand: null,
  otoAllowed: true,
  ocoAllowed: true,
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
        adjustments: [],
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
    const futures = { ...long, market: "usdm" as const, leverage: 2 };
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
      market: "usdm" as const,
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

describe("fitToMinNotional", () => {
  const r = { stepSize: "0.001", minNotional: 50 };
  it("$49,77 у BTC поднимается до минимума с запасом, округление вверх к шагу", () => {
    const qty = fitToMinNotional(0.0007, 71_100, r);
    expect(qty * 71_100).toBeGreaterThanOrEqual(50);
    expect(qty).toBeCloseTo(0.001, 9);
  });
  it("объём уже выше минимума — без изменений", () => {
    expect(fitToMinNotional(0.002, 71_100, r)).toBe(0.002);
  });
  it("минимум больше втрое — не поднимаем (сделка была бы не той)", () => {
    expect(fitToMinNotional(0.0001, 71_100, r)).toBe(0.0001);
  });
});

describe("fitToMinNotional после округления (spec 0012, AC1)", () => {
  // BTCUSDT на демо-фьючерсах: шаг 0,0001, минимум $50.
  const btc = { stepSize: "0.0001", minNotional: 50 };
  it("$50 ровно на минимуме, но после округления вниз $48,99 — поднимаем на шаг", () => {
    const qty = fitToMinNotional(50 / 81_650, 81_650, btc);
    expect(floorToStep(qty, btc.stepSize)).toBe("0.0007");
  });
  it("не поднимает выше лимита на сделку", () => {
    expect(fitToMinNotional(50 / 81_650, 81_650, btc, 55)).toBe(50 / 81_650);
  });
  it("validateTrade: вход BTCUSDT на $50 проходит, объём на бирже ≥ minNotional", () => {
    const result = validateTrade(
      {
        symbol: "BTCUSDT",
        market: "usdm",
        direction: "long",
        quantity: 50 / 81_650,
        stopLoss: 80_000,
        takeProfit: 85_000,
        leverage: 1,
        fitMinNotional: true,
      },
      {
        price: 81_650,
        rules: {
          ...rules,
          tickSize: "0.10",
          stepSize: "0.0001",
          minQty: 0.0001,
          minNotional: 50,
        },
        maxNotionalUsd: 100,
        availableUsd: 5000,
        maxRiskPct: 0.02,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quantity).toBe("0.0007");
      expect(result.value.notionalUsd).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("стоп и тейк в пределах фильтра цены биржи (spec 0012, AC3)", () => {
  // Реальные фильтры demo-api.binance.com 2026-10-15 (SUSDT и BATUSDT одинаковые):
  // PERCENT_PRICE_BY_SIDE bidUp 1.2, bidDown 0.5, askUp 2, askDown 0.8.
  const band = { bidUp: 1.2, bidDown: 0.5, askUp: 2, askDown: 0.8 };
  const spotRules = (tickSize: string, stepSize: string) => ({
    tickSize,
    stepSize,
    minQty: Number(stepSize),
    minNotional: 5,
    priceBand: band,
    otoAllowed: true,
    ocoAllowed: true,
  });

  it("fitToPriceBand: SELL-стоп ниже askDown — к границе +1%, в пределах — null", () => {
    expect(fitToPriceBand(50, 100, band, "SELL")).toBeCloseTo(81, 9);
    expect(fitToPriceBand(250, 100, band, "SELL")).toBeCloseTo(199, 9);
    expect(fitToPriceBand(90, 100, band, "SELL")).toBeNull();
    // BUY-стоп шорта выше bidUp.
    expect(fitToPriceBand(150, 100, band, "BUY")).toBeCloseTo(119, 9);
  });

  it("SUSDT 14 окт.: страховочный стоп −50% подтянут, шаг виден", () => {
    const result = validateTrade(
      {
        symbol: "SUSDT",
        market: "spot",
        direction: "long",
        quantity: 930,
        stopLoss: 0.02688,
        takeProfit: 0.3,
        leverage: 1,
        stopOnly: true,
      },
      ctx({ price: 0.05376, rules: spotRules("0.00001000", "0.10000000") }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stopLoss).toBe("0.04355");
      expect(result.value.adjustments).toEqual([
        "Стоп подтянут к границе фильтра биржи: 0.02688 → 0.04355",
      ]);
    }
  });

  it("BATUSDT: стоп и «дальний» тейк за фильтром подтянуты оба", () => {
    const result = validateTrade(
      {
        symbol: "BATUSDT",
        market: "spot",
        direction: "long",
        quantity: 293,
        stopLoss: 0.0853,
        takeProfit: 1.0225,
        leverage: 1,
      },
      ctx({ price: 0.1705, rules: spotRules("0.00010000", "1.00000000") }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stopLoss).toBe("0.1381");
      expect(result.value.takeProfit).toBe("0.3393");
      expect(result.value.adjustments).toHaveLength(2);
      expect(result.value.adjustments[1]).toBe(
        "Тейк подтянут к границе фильтра биржи: 1.0225 → 0.3393",
      );
    }
  });

  it("фьючерсы (фильтра в правилах нет) — стоп не трогаем", () => {
    const result = validateTrade(
      {
        ...long,
        market: "usdm",
        quantity: 0.0257,
        stopLoss: 1000,
        takeProfit: 2100,
      },
      ctx({ availableUsd: 100_000 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stopLoss).toBe("1000.00");
      expect(result.value.adjustments).toEqual([]);
    }
  });
});

describe("спот: деньги на LIMIT FOK и минимум стопа (ревью #48)", () => {
  // Реальные правила BATUSDT на demo-api.binance.com 2026-10-15.
  const bat = {
    tickSize: "0.00010000",
    stepSize: "1.00000000",
    minQty: 1,
    minNotional: 5,
    priceBand: null,
    otoAllowed: true,
    ocoAllowed: true,
  };
  const batLong: TradeRequest = {
    symbol: "BATUSDT",
    market: "spot",
    direction: "long",
    quantity: 100,
    stopLoss: 0.16,
    takeProfit: 0.2,
    leverage: 1,
  };
  const batCtx = (patch: Partial<TradeContext> = {}) =>
    ctx({ price: 0.17, rules: bat, availableUsd: 1000, ...patch });

  it("баланс на грани: нужно объём +0,5% (биржа блокирует USDT по лимитной цене FOK)", () => {
    // 100 BAT × 0,17 = $17; с +0,5% — $17,085: $17,05 раньше проходило, а биржа отклонила бы FOK.
    // Риск здесь не проверяем (maxRiskPct 100%).
    expect(
      validateTrade(batLong, batCtx({ availableUsd: 17.09, maxRiskPct: 1 })).ok,
    ).toBe(true);
    const result = validateTrade(
      batLong,
      batCtx({ availableUsd: 17.05, maxRiskPct: 1 }),
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        "Нужно $17.08 USDT (с запасом 0,5% на цену покупки), а на Spot свободно $17.05.",
      ],
    });
  });

  it("стоп после комиссии дешевле minNotional — понятная ошибка до отправки", () => {
    // Демо 2026-10-15: 31 BAT, стоп продаёт 30 × 0,16 = $4,80 < $5 → биржа отклонила OTO целиком.
    const result = validateTrade({ ...batLong, quantity: 31 }, batCtx());
    expect(result).toEqual({
      ok: false,
      errors: [
        "Стоп продаст 30 (куплено минус комиссия 0,1%) по 0.1600 — это $4.80, меньше минимального ордера ($5): биржа отклонит заявку. Увеличьте количество.",
      ],
    });
    // Ручная сделка ровно на минимуме по цене: покупка проходит, стоп — нет.
    expect(
      validateTrade({ ...batLong, quantity: 30 }, batCtx({ price: 1 / 6 })).ok,
    ).toBe(false);
    // Со стопом 0,167: 30 × 0,167 = $5,01 — биржа приняла (демо 2026-10-15).
    expect(
      validateTrade({ ...batLong, quantity: 31, stopLoss: 0.167 }, batCtx()).ok,
    ).toBe(true);
  });

  it("на фьючерсах комиссия из маржи — минимум стопа не проверяем", () => {
    const result = validateTrade(
      { ...batLong, market: "usdm", quantity: 30 },
      batCtx(),
    );
    expect(result.ok).toBe(true);
  });

  it("spotStopNotional: продажа после комиссии вниз к шагу × цена стопа", () => {
    expect(spotStopNotional(31, 0.16, "1")).toBeCloseTo(4.8, 9);
    expect(spotSellQuantity(40, "1.00000000")).toBe("39");
  });

  it("fitMinNotional (зеркало): объём поднимается, чтобы и стоп прошёл минимум", () => {
    const q = fitSpotStopToMinNotional(31, 0.17, 0.16, bat);
    expect(q).toBe(33);
    expect(spotStopNotional(q, 0.16, "1")).toBeGreaterThanOrEqual(5);
    // Дальше лимита ×3 или выше maxNotional не поднимаем.
    expect(fitSpotStopToMinNotional(5, 0.17, 0.16, bat)).toBe(5);
    expect(fitSpotStopToMinNotional(31, 0.17, 0.16, bat, 5.5)).toBe(31);

    const result = validateTrade(
      { ...batLong, quantity: 30, fitMinNotional: true },
      batCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.quantity).toBe("33");
  });
});
