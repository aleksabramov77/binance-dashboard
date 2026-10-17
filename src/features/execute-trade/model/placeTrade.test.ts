import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeRequest } from "@/entities/trade";
import { BinanceApiError } from "@/shared/api/binance/signed";
import type { TradeVenue } from "@/shared/api/binance/venue.server";

// Вход зеркала COIN-M на demo-dapi (spec 0056): правила, деньги, режим, маржа, «стоп до входа», вход и тейк — на рынке
// coinm, количество — контракты, итог и ссылки — как у USDⓈ-M, объём сделки — в монете. Сеть подменена.
const api = vi.hoisted(() => ({
  fetchDemoSymbolRules: vi.fn(),
  fetchDemoPrice: vi.fn(),
  fetchDemoCoinmAvailable: vi.fn(),
  fetchDemoUsdtBalances: vi.fn(),
  fetchDemoPositionMode: vi.fn(),
  fetchDemoFuturesAccountBusy: vi.fn(),
  demoEnableHedgeMode: vi.fn(),
  fetchDemoFuturesSymbolState: vi.fn(),
  demoFuturesPrepare: vi.fn(),
  demoFuturesProtect: vi.fn(),
  demoFuturesMarketOrder: vi.fn(),
  fetchDemoFuturesOrder: vi.fn(),
  demoCancelAlgoOrder: vi.fn(),
  fetchDemoAlgoOrder: vi.fn(),
  demoFuturesReduceMarket: vi.fn(),
  demoFuturesPositions: vi.fn(),
}));
vi.mock("@/shared/api/binance/demo.server", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/binance/demo.server")>()),
  ...api,
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { placeTrade } = await import("./placeTrade");

const venue: TradeVenue = {
  kind: "demo",
  publicUrl: { spot: "https://s", usdm: "https://f", coinm: "https://d" },
  signed: vi.fn(),
};
const ctx = {
  venue,
  maxNotionalUsd: 1000,
  maxRiskPct: 0.02,
  autoHedge: true,
};

// Paper-вход PC99 по BTCUSD_PERP: 1 контракт по $100 при входе 81 000 → 100 / 81 000 BTC.
const req: TradeRequest = {
  symbol: "BTCUSD_PERP",
  market: "coinm",
  direction: "long",
  quantity: 100 / 81_000,
  stopLoss: 77_000,
  takeProfit: 85_000,
  leverage: 1,
  fitMinNotional: true,
  stopOnly: false,
  mirror: true,
  referencePrice: 81_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDemoSymbolRules.mockResolvedValue({
    tickSize: "0.1",
    stepSize: "1",
    minQty: 1,
    minNotional: 0,
    priceBand: null,
    otoAllowed: false,
    ocoAllowed: false,
    contract: { size: 100, marginAsset: "BTC" },
  });
  api.fetchDemoPrice.mockResolvedValue(81_050);
  api.fetchDemoCoinmAvailable.mockResolvedValue(new Map([["BTC", 0.01]]));
  api.fetchDemoPositionMode.mockResolvedValue("hedge");
  api.fetchDemoFuturesSymbolState.mockResolvedValue({
    positions: [],
    orders: [],
    algos: [],
  });
  api.demoFuturesPrepare.mockResolvedValue("isolated");
  api.demoFuturesProtect.mockImplementation(
    async (_v, _s, _side, type, _t, _q, _p, clientAlgoId) => ({
      algoId: type === "STOP_MARKET" ? 4535901846 : 4535901942,
      clientAlgoId,
    }),
  );
  // POST входа на dapi — без avgPrice (проба 2026-10-17): цена — из GET ордера.
  api.demoFuturesMarketOrder.mockResolvedValue({
    orderId: 4535901891,
    status: "FILLED",
    executedQty: 1,
    avgPrice: 0,
  });
  api.fetchDemoFuturesOrder.mockResolvedValue({
    orderId: 4535901891,
    status: "FILLED",
    executedQty: 1,
    avgPrice: 80_921.21,
  });
});

describe("placeTrade: COIN-M на demo-dapi (spec 0056)", () => {
  it("1 контракт, плечо 1, изолированная, стоп до входа и тейк на рынке coinm; объём сделки — в монете", async () => {
    const r = await placeTrade(req, ctx, { tradeId: "t1" });
    expect(r.status).toBe("protected");
    expect(r.entryPrice).toBe(80_921.21);
    expect(r.filledQuantity).toBeCloseTo(100 / 80_921.21, 12);
    expect(r.protectRefs).toEqual({
      market: "coinm",
      entryOrderId: 4535901891,
      legs: "quantity",
      stop: { algoId: 4535901846, clientAlgoId: "bdt1-S" },
      takeProfit: { algoId: 4535901942, clientAlgoId: "bdt1-T" },
      contracts: 1,
      contractSize: 100,
    });
    // Справочник, цена и режим позиций — COIN-M; деньги — маржа BTC в $.
    expect(api.fetchDemoSymbolRules).toHaveBeenCalledWith(
      "coinm",
      "BTCUSD_PERP",
      venue,
    );
    expect(api.fetchDemoUsdtBalances).not.toHaveBeenCalled();
    expect(api.fetchDemoPositionMode).toHaveBeenCalledWith(venue, "coinm");
    expect(api.demoFuturesPrepare).toHaveBeenCalledWith(
      venue,
      "BTCUSD_PERP",
      1,
      "coinm",
    );
    const side = { mode: "hedge", direction: "long" };
    // Стоп до входа — на объём заявки в контрактах, затем вход и тейк.
    expect(api.demoFuturesProtect.mock.calls).toEqual([
      [
        venue,
        "BTCUSD_PERP",
        "SELL",
        "STOP_MARKET",
        "77000.0",
        "1",
        side,
        "bdt1-S",
        "coinm",
      ],
      [
        venue,
        "BTCUSD_PERP",
        "SELL",
        "TAKE_PROFIT_MARKET",
        "85000.0",
        "1",
        side,
        "bdt1-T",
        "coinm",
      ],
    ]);
    expect(api.demoFuturesMarketOrder).toHaveBeenCalledWith(
      venue,
      "BTCUSD_PERP",
      "BUY",
      "1",
      "bdt1-M",
      side,
      "coinm",
    );
    expect(api.demoFuturesProtect.mock.invocationCallOrder[0]).toBeLessThan(
      api.demoFuturesMarketOrder.mock.invocationCallOrder[0],
    );
  });

  it("стоп до входа не встал — вход не отправляется, rejected без ссылок", async () => {
    api.demoFuturesProtect.mockRejectedValue(
      new BinanceApiError(
        "Binance: Order would immediately trigger. (-2021)",
        -2021,
      ),
    );
    const r = await placeTrade(req, ctx, { tradeId: "t2" });
    expect(r.status).toBe("rejected");
    expect(r.protectRefs).toBeNull();
    expect(api.demoFuturesMarketOrder).not.toHaveBeenCalled();
  });

  it("стоп не встал после входа (One-way) — откат своих контрактов на рынке coinm", async () => {
    api.fetchDemoPositionMode.mockResolvedValue("oneway");
    api.fetchDemoFuturesAccountBusy.mockResolvedValue(true);
    api.demoFuturesProtect.mockRejectedValue(
      new BinanceApiError(
        "Binance: Order would immediately trigger. (-2021)",
        -2021,
      ),
    );
    api.demoFuturesReduceMarket.mockResolvedValue({
      orderId: 9,
      status: "FILLED",
      executedQty: 1,
      avgPrice: 0,
    });
    const r = await placeTrade(req, ctx, { tradeId: "t3" });
    expect(api.fetchDemoFuturesAccountBusy).toHaveBeenCalledWith(
      venue,
      "coinm",
    );
    expect(api.demoFuturesReduceMarket).toHaveBeenCalledWith(
      venue,
      "BTCUSD_PERP",
      "SELL",
      "1",
      { mode: "oneway", direction: "long" },
      "bdt3-C",
      "coinm",
    );
    expect(r.status).toBe("rejected");
  });

  it("вход исполнен — onFilled до защиты, объём в монете (spec 0068, B1); сбой получателя сделку не ломает", async () => {
    api.fetchDemoPositionMode.mockResolvedValue("oneway");
    api.fetchDemoFuturesAccountBusy.mockResolvedValue(true);
    const onFilled = vi.fn(() => {
      throw new Error("получатель упал");
    });
    const r = await placeTrade(req, ctx, { tradeId: "t4", onFilled });
    expect(r.status).toBe("protected");
    expect(onFilled).toHaveBeenCalledTimes(1);
    const [fill] = onFilled.mock.calls[0] as unknown as [
      { entryPrice: number; filledQuantity: number },
    ];
    expect(fill.entryPrice).toBe(80_921.21);
    expect(fill.filledQuantity).toBeCloseTo(100 / 80_921.21, 12);
    // One-way: вход → «исполнен» → стоп и тейк.
    const at = onFilled.mock.invocationCallOrder[0];
    expect(api.demoFuturesMarketOrder.mock.invocationCallOrder[0]).toBeLessThan(
      at,
    );
    expect(at).toBeLessThan(api.demoFuturesProtect.mock.invocationCallOrder[0]);
  });

  it("мало маржи в монете контракта — rejected до ордеров", async () => {
    api.fetchDemoCoinmAvailable.mockResolvedValue(new Map([["BTC", 0.0005]]));
    const r = await placeTrade(req, ctx, { tradeId: "t4" });
    expect(r.status).toBe("rejected");
    expect(r.message).toMatch(/COIN-M Futures \(BTC\)/);
    expect(api.demoFuturesPrepare).not.toHaveBeenCalled();
  });
});
