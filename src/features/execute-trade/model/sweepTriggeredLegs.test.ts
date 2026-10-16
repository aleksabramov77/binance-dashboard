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
    expect(api.fetchDemoAlgoOrder).toHaveBeenCalledWith(expect.anything(), {
      algoId: 21,
    });
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
    expect(api.demoCancelAlgoOrder).toHaveBeenCalledWith(expect.anything(), {
      algoId: 32,
    });
  });
});
