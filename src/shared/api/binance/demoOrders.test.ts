import { describe, expect, it } from "vitest";
import {
  clientIdGroup,
  toFuturesSymbolOrders,
  toSpotSymbolOrders,
} from "./demoOrders";
import {
  algoHistorySchema,
  futuresAllOrdersSchema,
  spotAllOrdersSchema,
} from "./demoSchemas";

// Формы ответов — как у демо-API 2026-10-10 (лишние поля опущены).
const algos = algoHistorySchema.parse([
  {
    symbol: "BATUSDT",
    orderType: "STOP_MARKET",
    side: "BUY",
    algoStatus: "FINISHED",
    triggerPrice: "0.137770",
    actualOrderId: "362733533",
  },
  {
    symbol: "BATUSDT",
    orderType: "TAKE_PROFIT_MARKET",
    side: "BUY",
    algoStatus: "EXPIRED",
    triggerPrice: "0.116050",
    actualOrderId: "",
  },
  {
    symbol: "BATUSDT",
    orderType: "STOP_MARKET",
    side: "BUY",
    algoStatus: "NEW",
    triggerPrice: "0.140200",
    actualOrderId: "",
  },
  {
    symbol: "BATUSDT",
    orderType: "TAKE_PROFIT_MARKET",
    side: "BUY",
    algoStatus: "NEW",
    triggerPrice: "0.120700",
  },
]);

describe("toFuturesSymbolOrders", () => {
  it("сработавший algo-стоп → «sl» по actualOrderId; активный стоп — в openStops", () => {
    const result = toFuturesSymbolOrders(algos, []);
    expect([...result.closeKinds]).toEqual([[362733533, "sl"]]);
    expect(result.openStops).toEqual([
      { side: "BUY", triggerPrice: 0.1402, trailing: false, group: null },
    ]);
  });

  it("нет actualOrderId → не попадает в closeKinds (не NaN)", () => {
    const result = toFuturesSymbolOrders(algos, []);
    expect([...result.closeKinds.keys()].some(Number.isNaN)).toBe(false);
  });

  it("ликвидация по clientOrderId; ручной MARKET — не в карте", () => {
    const orders = futuresAllOrdersSchema.parse([
      {
        orderId: 1,
        type: "MARKET",
        side: "BUY",
        status: "FILLED",
        clientOrderId: "autoclose-1791",
        stopPrice: "0",
      },
      {
        orderId: 2,
        type: "MARKET",
        side: "SELL",
        status: "FILLED",
        clientOrderId: "web_abc",
        stopPrice: "0",
      },
      {
        orderId: 3,
        type: "TRAILING_STOP_MARKET",
        side: "SELL",
        status: "NEW",
        clientOrderId: "x",
        stopPrice: "0",
      },
    ]);
    const result = toFuturesSymbolOrders([], orders);
    expect(result.closeKinds.get(1)).toBe("liquidation");
    expect(result.closeKinds.has(2)).toBe(false);
    expect(result.openStops).toEqual([
      { side: "SELL", triggerPrice: 0, trailing: true, group: null },
    ]);
  });
});

describe("toSpotSymbolOrders", () => {
  it("OCO: исполненный LIMIT_MAKER → «tp», STOP_LOSS → «sl», активный стоп — openStops", () => {
    const orders = spotAllOrdersSchema.parse([
      {
        orderId: 10,
        type: "MARKET",
        side: "BUY",
        status: "FILLED",
        stopPrice: "0",
      },
      {
        orderId: 11,
        type: "LIMIT_MAKER",
        side: "SELL",
        status: "FILLED",
        stopPrice: "0",
      },
      {
        orderId: 12,
        type: "STOP_LOSS",
        side: "SELL",
        status: "FILLED",
        stopPrice: "2420",
      },
      {
        orderId: 13,
        type: "STOP_LOSS",
        side: "SELL",
        status: "NEW",
        stopPrice: "2400",
      },
      {
        orderId: 14,
        type: "STOP_LOSS",
        side: "SELL",
        status: "CANCELED",
        stopPrice: "2400",
      },
    ]);
    const result = toSpotSymbolOrders(orders);
    expect(result.closeKinds.get(10)).toBeUndefined();
    expect(result.closeKinds.get(11)).toBe("tp");
    expect(result.closeKinds.get(12)).toBe("sl");
    expect(result.openStops).toEqual([
      { side: "SELL", triggerPrice: 2400, trailing: false, group: null },
    ]);
  });
});

describe("свои сделки по clientOrderId (spec 0012, PR 2d)", () => {
  it("clientIdGroup: bd<id>-<роль> → сделка; чужие id — null", () => {
    expect(clientIdGroup("bdd2248f1ca0b143a6b6957361-S")).toBe(
      "bdd2248f1ca0b143a6b6957361",
    );
    expect(clientIdGroup("bd253b690480a7462996cba4e0-T2")).toBe(
      "bd253b690480a7462996cba4e0",
    );
    for (const id of ["foreign-ada-stop", "web_123", "", null, "autoclose-1"])
      expect(clientIdGroup(id)).toBeNull();
  });
  it("фьючерсы: сработавший свой algo — в сделке по actualOrderId; вход и закрытие — по clientOrderId", () => {
    const algos = [
      {
        symbol: "ADAUSDT",
        orderType: "TAKE_PROFIT_MARKET",
        side: "SELL" as const,
        algoStatus: "FINISHED",
        triggerPrice: 0.23,
        actualOrderId: 900,
        clientAlgoId: "bdaaa-T",
      },
      {
        symbol: "ADAUSDT",
        orderType: "STOP_MARKET",
        side: "SELL" as const,
        algoStatus: "NEW",
        triggerPrice: 0.21,
        actualOrderId: null,
        clientAlgoId: "bdbbb-S",
      },
    ];
    const orders = [
      {
        orderId: 1,
        type: "MARKET",
        side: "BUY" as const,
        status: "FILLED",
        clientOrderId: "bdaaa-M",
        stopPrice: 0,
      },
      {
        orderId: 2,
        type: "MARKET",
        side: "BUY" as const,
        status: "FILLED",
        clientOrderId: "bdbbb-M",
        stopPrice: 0,
      },
      {
        orderId: 3,
        type: "MARKET",
        side: "SELL" as const,
        status: "FILLED",
        clientOrderId: "web_x",
        stopPrice: 0,
      },
    ];
    const r = toFuturesSymbolOrders(algos, orders);
    expect(r.groups).toEqual(
      new Map([
        [900, "bdaaa"],
        [1, "bdaaa"],
        [2, "bdbbb"],
      ]),
    );
    expect(r.openStops).toEqual([
      { side: "SELL", triggerPrice: 0.21, trailing: false, group: "bdbbb" },
    ]);
  });
});
