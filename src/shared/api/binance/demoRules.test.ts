import { describe, expect, it } from "vitest";
import { toPriceBand, toRules } from "./demoRules";
import { exchangeInfoSchema } from "./demoSchemas";

// Фрагменты реального exchangeInfo демо-бирж 2026-10-15.
const sUsdtSpot = {
  symbol: "SUSDT",
  status: "TRADING",
  ocoAllowed: true,
  otoAllowed: true,
  filters: [
    {
      filterType: "PRICE_FILTER",
      minPrice: "0.00001000",
      maxPrice: "100.00000000",
      tickSize: "0.00001000",
    },
    {
      filterType: "LOT_SIZE",
      minQty: "0.10000000",
      maxQty: "913205152.00000000",
      stepSize: "0.10000000",
    },
    {
      filterType: "PERCENT_PRICE_BY_SIDE",
      bidMultiplierUp: "1.2",
      bidMultiplierDown: "0.5",
      askMultiplierUp: "2",
      askMultiplierDown: "0.8",
      avgPriceMins: 5,
    },
    {
      filterType: "NOTIONAL",
      minNotional: "5.00000000",
      applyMinToMarket: true,
      maxNotional: "9000000.00000000",
      applyMaxToMarket: false,
      avgPriceMins: 5,
    },
  ],
};

const btcFutures = {
  symbol: "BTCUSDT",
  status: "TRADING",
  filters: [
    {
      filterType: "PRICE_FILTER",
      minPrice: "261.10",
      tickSize: "0.10",
      maxPrice: "809484",
    },
    {
      filterType: "LOT_SIZE",
      maxQty: "1000",
      minQty: "0.0001",
      stepSize: "0.0001",
    },
    { filterType: "MIN_NOTIONAL", notional: "50" },
    {
      multiplierDecimal: "4",
      filterType: "PERCENT_PRICE",
      multiplierDown: "0.9500",
      multiplierUp: "1.0500",
    },
  ],
};

describe("toRules", () => {
  it("спот SUSDT: шаги, минимум и коридор PERCENT_PRICE_BY_SIDE", () => {
    const info = exchangeInfoSchema.parse({ symbols: [sUsdtSpot] });
    expect(toRules("spot", info.symbols[0])).toEqual({
      tickSize: "0.00001000",
      stepSize: "0.10000000",
      minQty: 0.1,
      minNotional: 5,
      priceBand: { bidUp: 1.2, bidDown: 0.5, askUp: 2, askDown: 0.8 },
      otoAllowed: true,
      ocoAllowed: true,
    });
  });

  it("фьючерсы BTCUSDT: MIN_NOTIONAL, PERCENT_PRICE в коридор не идёт (algo-стопы он не ограничивает)", () => {
    const info = exchangeInfoSchema.parse({ symbols: [btcFutures] });
    expect(toRules("futures", info.symbols[0])).toEqual({
      tickSize: "0.10",
      stepSize: "0.0001",
      minQty: 0.0001,
      minNotional: 50,
      priceBand: null,
      otoAllowed: false,
      ocoAllowed: false,
    });
  });

  it("без PRICE_FILTER / LOT_SIZE торговать нельзя", () => {
    expect(toRules("spot", { filters: [] })).toBeNull();
  });
});

describe("toPriceBand", () => {
  it("общий PERCENT_PRICE — одинаково для обеих сторон", () => {
    expect(toPriceBand(btcFutures.filters)).toEqual({
      bidUp: 1.05,
      bidDown: 0.95,
      askUp: 1.05,
      askDown: 0.95,
    });
  });
  it("нет фильтра или он битый — null", () => {
    expect(toPriceBand([])).toBeNull();
    expect(
      toPriceBand([{ filterType: "PERCENT_PRICE", multiplierUp: "x" }]),
    ).toBeNull();
  });
});
