import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeVenue } from "@/shared/api/binance/venue.server";

// Порядок закрытия по своим ордерам (spec 0049): свои TP/SL снимаются до рыночного выхода (на споте OCO держит монеты —
// иначе не продать). Выход не прошёл — результат помечает «защита снята», реальное зеркало ставит «без защиты» и
// повторяет закрытие каждый прогон. Сеть подменена.
const api = vi.hoisted(() => ({
  fetchDemoAlgoOrder: vi.fn(),
  demoCancelAlgoOrder: vi.fn(),
  fetchDemoSymbolRules: vi.fn(),
  fetchDemoPositionMode: vi.fn(),
  demoFuturesPositions: vi.fn(),
  demoFuturesReduceMarket: vi.fn(),
  fetchDemoFuturesOrder: vi.fn(),
  fetchDemoFills: vi.fn(),
}));
vi.mock("@/shared/api/binance/demo.server", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/binance/demo.server")>()),
  ...api,
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { closeDemoPosition } = await import("./closeDemoPosition");

const venue: TradeVenue = {
  kind: "live",
  publicUrl: { spot: "https://s", usdm: "https://f" },
  signed: vi.fn(),
};

const req = {
  market: "usdm" as const,
  symbol: "ETHUSDT",
  direction: "long" as const,
  quantity: 0.005,
  protectRefs: {
    market: "usdm" as const,
    entryOrderId: 1,
    legs: "quantity" as const,
    stop: { algoId: 11, clientAlgoId: "bdx-S" },
    takeProfit: { algoId: 12, clientAlgoId: "bdx-T" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDemoAlgoOrder.mockResolvedValue({
    algoId: 11,
    algoStatus: "NEW",
    actualOrderId: null,
    actualPrice: 0,
    actualQty: 0,
  });
  api.demoCancelAlgoOrder.mockResolvedValue(true);
  api.fetchDemoSymbolRules.mockResolvedValue({
    stepSize: "0.001",
    tickSize: "0.01",
    minQty: 0.001,
    minNotional: 5,
  });
  api.fetchDemoPositionMode.mockResolvedValue("oneway");
  api.demoFuturesPositions.mockResolvedValue([
    { positionSide: "BOTH", amount: 0.005, entryPrice: 2000 },
  ]);
});

describe("closeDemoPosition: свои TP/SL сняты, а выход не прошёл", () => {
  it("failed + protectionRemoved; площадка — та, что передана (справочник реального рынка)", async () => {
    api.demoFuturesReduceMarket.mockRejectedValue(new Error("timeout"));
    const r = await closeDemoPosition(req, venue);
    expect(api.demoCancelAlgoOrder).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("failed");
    expect(r.protectionRemoved).toBe(true);
    expect(api.fetchDemoSymbolRules).toHaveBeenCalledWith(
      "usdm",
      "ETHUSDT",
      venue,
    );
  });

  it("повтор: ноги уже сняты (CANCELED) — сразу рыночный выход, снимать нечего", async () => {
    api.fetchDemoAlgoOrder.mockResolvedValue({
      algoId: 11,
      algoStatus: "CANCELED",
      actualOrderId: null,
      actualPrice: 0,
      actualQty: 0,
    });
    api.demoFuturesReduceMarket.mockResolvedValue({
      orderId: 5,
      avgPrice: 2100,
      executedQty: 0.005,
    });
    const r = await closeDemoPosition(req, venue);
    expect(api.demoCancelAlgoOrder).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: "closed", exitPrice: 2100 });
    expect(r.protectionRemoved).toBeUndefined();
  });

  it("не прочитали свои ноги — ничего не сняли: failed без пометки «защита снята»", async () => {
    api.fetchDemoAlgoOrder.mockRejectedValue(new Error("-1021"));
    const r = await closeDemoPosition(req, venue);
    expect(r.status).toBe("failed");
    expect(r.protectionRemoved).toBeUndefined();
    expect(api.demoCancelAlgoOrder).not.toHaveBeenCalled();
  });
});
