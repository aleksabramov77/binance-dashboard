import { beforeEach, describe, expect, it, vi } from "vitest";

// Модельный тест сверки ног: сеть (демо-API) и ключ подменены.
const api = vi.hoisted(() => ({
  fetchDemoOpenAlgoOrders: vi.fn(),
  fetchDemoAlgoOrder: vi.fn(),
  demoCancelAlgoOrder: vi.fn(),
  fetchDemoFuturesOrder: vi.fn(),
}));
vi.mock("@/shared/api/binance/demo.server", () => api);
vi.mock("@/shared/config/env.server", () => ({
  getDemoTradingConfig: () => ({
    credentials: { apiKey: "k", apiSecret: "s" },
    maxNotionalUsd: 1000,
  }),
}));

const { sweepTriggeredLegs } = await import("./sweepTriggeredLegs");

const stopOnly = {
  tradeId: "m1",
  symbol: "ADAUSDT",
  protectRefs: {
    market: "usdm" as const,
    entryOrderId: 1,
    legs: "quantity" as const,
    stop: { algoId: 21, clientAlgoId: "bdm1-S" },
    takeProfit: null,
  },
};

describe("sweepTriggeredLegs: зеркало без тейка (stopOnly)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("единственный стоп сработал — строка закрыта биржей, снимать нечего, докрытия нет", async () => {
    api.fetchDemoOpenAlgoOrders.mockResolvedValue([]);
    api.fetchDemoAlgoOrder.mockResolvedValue({
      algoId: 21,
      algoStatus: "FINISHED",
      actualOrderId: 900,
      actualPrice: 0.2192,
      actualQty: 40,
    });
    const swept = await sweepTriggeredLegs([stopOnly]);
    expect(swept).toEqual([
      expect.objectContaining({
        tradeId: "m1",
        closedBy: "stop",
        exitPrice: 0.2192,
        message: "Позиция закрыта биржей: сработал стоп.",
      }),
    ]);
    expect(api.fetchDemoAlgoOrder).toHaveBeenCalledWith(
      expect.anything(),
      { algoId: 21 },
      { market: "usdm" },
    );
    expect(api.demoCancelAlgoOrder).not.toHaveBeenCalled();
  });

  it("стоп стоит — ничего; пропал не срабатыванием (снят) — не закрываем", async () => {
    api.fetchDemoOpenAlgoOrders.mockResolvedValue([
      { algoId: 21, clientAlgoId: "bdm1-S" },
    ]);
    expect(await sweepTriggeredLegs([stopOnly])).toEqual([]);
    expect(api.fetchDemoAlgoOrder).not.toHaveBeenCalled();

    api.fetchDemoOpenAlgoOrders.mockResolvedValue([]);
    api.fetchDemoAlgoOrder.mockResolvedValue({
      algoId: 21,
      algoStatus: "CANCELED",
      actualOrderId: null,
      actualPrice: 0,
      actualQty: 0,
    });
    expect(await sweepTriggeredLegs([stopOnly])).toEqual([]);
  });

  it("бюджет прогона исчерпан — сверку не начинаем", async () => {
    api.fetchDemoOpenAlgoOrders.mockResolvedValue([]);
    expect(await sweepTriggeredLegs([stopOnly], () => true)).toEqual([]);
    expect(api.fetchDemoAlgoOrder).not.toHaveBeenCalled();
  });
});

describe("sweepTriggeredLegs: нога сработала раньше входа (ревью #80)", () => {
  beforeEach(() => vi.clearAllMocks());
  const both = {
    tradeId: "m2",
    symbol: "ADAUSDT",
    protectRefs: {
      market: "usdm" as const,
      entryOrderId: 1,
      legs: "quantity" as const,
      stop: { algoId: 31, clientAlgoId: "bdm2-S" },
      takeProfit: { algoId: 32, clientAlgoId: "bdm2-T" },
    },
  };

  it("исполнено 0 — строка unprotected (позиция без стопа), тейк не снимаем", async () => {
    api.fetchDemoOpenAlgoOrders.mockResolvedValue([
      { algoId: 32, clientAlgoId: "bdm2-T" },
    ]);
    api.fetchDemoAlgoOrder.mockResolvedValue({
      algoId: 31,
      algoStatus: "FINISHED",
      actualOrderId: 901,
      actualPrice: 0,
      actualQty: 0,
    });
    api.fetchDemoFuturesOrder.mockResolvedValue({
      orderId: 901,
      status: "EXPIRED",
      executedQty: 0,
      avgPrice: 0,
    });
    const swept = await sweepTriggeredLegs([both]);
    expect(swept).toEqual([
      expect.objectContaining({ tradeId: "m2", status: "unprotected" }),
    ]);
    expect(api.demoCancelAlgoOrder).not.toHaveBeenCalled();
    // Уже помечена unprotected — повторно не сообщаем.
    expect(
      await sweepTriggeredLegs([{ ...both, status: "unprotected" }]),
    ).toEqual([]);
  });

  it("исполнено по рыночному ордеру (actualQty нет) — закрыто биржей, тейк снят", async () => {
    api.fetchDemoOpenAlgoOrders.mockResolvedValue([
      { algoId: 32, clientAlgoId: "bdm2-T" },
    ]);
    api.fetchDemoAlgoOrder.mockResolvedValue({
      algoId: 31,
      algoStatus: "FINISHED",
      actualOrderId: 902,
      actualPrice: 0.21,
      actualQty: 0,
    });
    api.fetchDemoFuturesOrder.mockResolvedValue({
      orderId: 902,
      status: "FILLED",
      executedQty: 40,
      avgPrice: 0.21,
    });
    api.demoCancelAlgoOrder.mockResolvedValue(true);
    expect(await sweepTriggeredLegs([both])).toEqual([
      expect.objectContaining({ tradeId: "m2", status: "closed" }),
    ]);
    expect(api.demoCancelAlgoOrder).toHaveBeenCalledWith(
      expect.anything(),
      { algoId: 32 },
      { market: "usdm" },
    );
  });
});

describe("sweepTriggeredLegs: COIN-M (spec 0056)", () => {
  beforeEach(() => vi.clearAllMocks());
  // Условные ордера dapi: algoId — orderId, clientAlgoId — clientOrderId; объём — контракты.
  const coinm = {
    tradeId: "c1",
    symbol: "BTCUSD_PERP",
    protectRefs: {
      market: "coinm" as const,
      entryOrderId: 1,
      legs: "quantity" as const,
      stop: { algoId: 41, clientAlgoId: "bdc1-S" },
      takeProfit: { algoId: 42, clientAlgoId: "bdc1-T" },
      contracts: 1,
      contractSize: 100,
    },
  };

  it("сработал тейк — стоп снимается по ордеру символа, строка закрыта биржей", async () => {
    // Демо 2026-10-17: тейк FILLED, соседний стоп остался NEW.
    api.fetchDemoOpenAlgoOrders.mockImplementation(async (_v, market) =>
      market === "coinm" ? [{ algoId: 41, clientAlgoId: "bdc1-S" }] : [],
    );
    api.fetchDemoAlgoOrder.mockResolvedValue({
      algoId: 42,
      algoStatus: "FINISHED",
      actualOrderId: 42,
      actualPrice: 81000.52,
      actualQty: 1,
    });
    api.demoCancelAlgoOrder.mockResolvedValue(true);
    expect(await sweepTriggeredLegs([coinm])).toEqual([
      expect.objectContaining({
        tradeId: "c1",
        status: "closed",
        closedBy: "takeProfit",
        exitPrice: 81000.52,
      }),
    ]);
    const at = { market: "coinm", symbol: "BTCUSD_PERP" };
    expect(api.fetchDemoOpenAlgoOrders).toHaveBeenCalledWith(
      expect.anything(),
      "coinm",
    );
    expect(api.fetchDemoAlgoOrder).toHaveBeenCalledWith(
      expect.anything(),
      { algoId: 42 },
      at,
    );
    expect(api.demoCancelAlgoOrder).toHaveBeenCalledWith(
      expect.anything(),
      { algoId: 41 },
      at,
    );
  });

  it("ордера COIN-M не загрузились — USDⓈ-M сверяется, COIN-M ждёт прогона", async () => {
    api.fetchDemoOpenAlgoOrders.mockImplementation(async (_v, market) => {
      if (market === "coinm") throw new Error("timeout");
      return [];
    });
    api.fetchDemoAlgoOrder.mockResolvedValue({
      algoId: 21,
      algoStatus: "FINISHED",
      actualOrderId: 900,
      actualPrice: 0.2192,
      actualQty: 40,
    });
    expect(await sweepTriggeredLegs([stopOnly, coinm])).toEqual([
      expect.objectContaining({ tradeId: "m1", status: "closed" }),
    ]);
  });
});
