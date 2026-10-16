import { beforeEach, describe, expect, it, vi } from "vitest";

// Модельный тест сверки ног: сеть (демо-API) и ключ подменены.
const api = vi.hoisted(() => ({
  fetchDemoOpenAlgoOrders: vi.fn(),
  fetchDemoAlgoOrder: vi.fn(),
  demoCancelAlgoOrder: vi.fn(),
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
