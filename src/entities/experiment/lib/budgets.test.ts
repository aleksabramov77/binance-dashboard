import { FEE_RATE } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { type BudgetInputs, computeMarketBudgets } from "./budgets";

const experiments: BudgetInputs["experiments"] = [
  { market: "spot", initialBudget: 10_000 },
  { market: "spot", initialBudget: 10_000 },
  { market: "usdm", initialBudget: 5_000 },
];

const byMarket = (
  inputs: BudgetInputs,
  prices: Parameters<typeof computeMarketBudgets>[1],
) =>
  Object.fromEntries(
    computeMarketBudgets(inputs, prices).map((b) => [b.market, b]),
  );

describe("computeMarketBudgets", () => {
  it("без сделок equity равен сумме стартов, изменение нулевое", () => {
    const r = byMarket({ experiments, closed: [], open: [] }, null);
    expect(r.spot).toMatchObject({
      initial: 20_000,
      equity: 20_000,
      change: 0,
      changePct: 0,
      unrealized: 0,
      openTrades: 0,
    });
    expect(r.usdm.initial).toBe(5_000);
  });

  it("всегда возвращает три группы в порядке Spot, USDⓈ-M, COIN-M, даже без экспериментов", () => {
    const r = computeMarketBudgets(
      { experiments: [], closed: [], open: [] },
      null,
    );
    expect(r.map((b) => b.market)).toEqual(["spot", "usdm", "coinm"]);
    // COIN-M без экспериментов — 0 $ и 0 %, а не пропуск.
    expect(r[2]).toMatchObject({ equity: 0, change: 0, changePct: 0 });
    expect(r[0].changePct).toBe(0);
  });

  it("нет цены COIN-M — у COIN-M нереализованный не учтён, у USDⓈ-M считается", () => {
    const r = byMarket(
      {
        experiments: [
          ...experiments,
          { market: "coinm", initialBudget: 10_000 },
        ],
        closed: [],
        open: [
          {
            market: "usdm",
            symbol: "BTCUSDT",
            direction: "long",
            entryPrice: 100,
            quantity: 1,
          },
          {
            market: "coinm",
            symbol: "BTCUSD_PERP",
            direction: "long",
            entryPrice: 100,
            quantity: 1,
          },
        ],
      },
      (market) => (market === "usdm" ? 110 : undefined),
    );
    expect(r.coinm).toMatchObject({ unrealized: null, equity: 10_000 });
    expect(r.usdm.unrealized).not.toBeNull();
  });

  it("складывает реализованный PnL (уже после комиссий) по своему рынку", () => {
    const r = byMarket(
      {
        experiments,
        closed: [
          { market: "spot", pnl: 300, fees: 12 },
          { market: "usdm", pnl: -250, fees: 5 },
        ],
        open: [],
      },
      null,
    );
    expect(r.spot).toMatchObject({ realized: 300, fees: 12, equity: 20_300 });
    expect(r.spot.change).toBe(300);
    expect(r.spot.changePct).toBeCloseTo(0.015);
    expect(r.usdm).toMatchObject({ equity: 4_750, change: -250 });
    expect(r.usdm.changePct).toBeCloseTo(-0.05);
  });

  it("учитывает нереализованный PnL открытых позиций по последней цене с комиссиями", () => {
    const r = byMarket(
      {
        experiments,
        closed: [],
        open: [
          {
            market: "usdm",
            symbol: "BTCUSDT",
            direction: "short",
            entryPrice: 100,
            quantity: 10,
          },
        ],
      },
      (market, symbol) =>
        market === "usdm" && symbol === "BTCUSDT" ? 90 : undefined,
    );
    const fees = FEE_RATE.usdm * 10 * (100 + 90);
    expect(r.usdm.unrealized).toBeCloseTo(100 - fees);
    expect(r.usdm.equity).toBeCloseTo(5_000 + 100 - fees);
    expect(r.usdm.openTrades).toBe(1);
    expect(r.spot.unrealized).toBe(0);
  });

  it("без цены хотя бы одной позиции не учитывает нереализованный PnL рынка", () => {
    const r = byMarket(
      {
        experiments,
        closed: [{ market: "spot", pnl: 50, fees: 1 }],
        open: [
          {
            market: "spot",
            symbol: "ETHUSDT",
            direction: "long",
            entryPrice: 10,
            quantity: 1,
          },
          {
            market: "spot",
            symbol: "NOPRICE",
            direction: "long",
            entryPrice: 10,
            quantity: 1,
          },
        ],
      },
      (_m, symbol) => (symbol === "ETHUSDT" ? 20 : undefined),
    );
    expect(r.spot.unrealized).toBeNull();
    expect(r.spot.equity).toBe(20_050);
    expect(r.spot.openTrades).toBe(2);
  });

  it("цены не загружены — нереализованный null, equity по реализованному", () => {
    const r = byMarket(
      {
        experiments,
        closed: [],
        open: [
          {
            market: "spot",
            symbol: "ETHUSDT",
            direction: "long",
            entryPrice: 10,
            quantity: 1,
          },
        ],
      },
      null,
    );
    expect(r.spot.unrealized).toBeNull();
    expect(r.spot.equity).toBe(20_000);
  });
});
