import { describe, expect, it } from "vitest";
import {
  coinmOrderAsAlgo,
  coinmOrderSchema,
  coinmOrdersSchema,
  coinmPair,
  splitCoinmOpenOrders,
} from "./coinmOrders";
import { toRules } from "./demoRules";
import { exchangeInfoSchema } from "./demoSchemas";

// Ответы demo-dapi из пробы 2026-10-17 (BTCUSD_PERP, Hedge, 1 контракт), сокращены.
const stopNew = {
  orderId: 4535901846,
  symbol: "BTCUSD_PERP",
  status: "NEW",
  clientOrderId: "bdprobe76932-S",
  price: "0.0",
  avgPrice: "0.00",
  origQty: "1",
  executedQty: "0",
  type: "STOP_MARKET",
  reduceOnly: true,
  closePosition: false,
  side: "SELL",
  positionSide: "LONG",
  stopPrice: "76873.1",
  workingType: "MARK_PRICE",
  priceProtect: true,
  origType: "STOP_MARKET",
  pair: "BTCUSD",
  cumBase: "0.00000000",
};
const takeFilled = {
  ...stopNew,
  orderId: 4535906855,
  clientOrderId: "bdtrig12564A-T",
  status: "FILLED",
  avgPrice: "81000.52",
  executedQty: "1",
  // Сработавший условный ордер: type MARKET, origType прежний.
  type: "MARKET",
  origType: "TAKE_PROFIT_MARKET",
  stopPrice: "81006.3",
};
const entryFilled = {
  ...stopNew,
  orderId: 4535901891,
  clientOrderId: "bdprobe76932-M",
  status: "FILLED",
  avgPrice: "80921.21",
  executedQty: "1",
  type: "MARKET",
  origType: "MARKET",
  reduceOnly: false,
  side: "BUY",
};

describe("coinmOrders: условные ордера dapi в виде algo-ордеров (spec 0056)", () => {
  it("стоящий стоп — NEW, algoId = orderId, clientAlgoId = clientOrderId, не сработал", () => {
    expect(coinmOrderAsAlgo(coinmOrderSchema.parse(stopNew))).toEqual({
      algoId: 4535901846,
      clientAlgoId: "bdprobe76932-S",
      algoStatus: "NEW",
      actualOrderId: null,
      actualPrice: 0,
      actualQty: 0,
    });
  });

  it("сработавший тейк — FINISHED с ценой и объёмом исполнения", () => {
    expect(coinmOrderAsAlgo(coinmOrderSchema.parse(takeFilled))).toMatchObject({
      algoStatus: "FINISHED",
      actualOrderId: 4535906855,
      actualPrice: 81000.52,
      actualQty: 1,
    });
  });

  it("сработал, но ещё не исполнился — TRIGGERING; частично — TRIGGERED; снят — как есть", () => {
    const base = coinmOrderSchema.parse(stopNew);
    expect(coinmOrderAsAlgo({ ...base, type: "MARKET" }).algoStatus).toBe(
      "TRIGGERING",
    );
    expect(
      coinmOrderAsAlgo({
        ...base,
        type: "MARKET",
        status: "PARTIALLY_FILLED",
        executedQty: 1,
      }),
    ).toMatchObject({ algoStatus: "TRIGGERED", actualOrderId: base.orderId });
    expect(coinmOrderAsAlgo({ ...base, status: "CANCELED" }).algoStatus).toBe(
      "CANCELED",
    );
  });

  it("POST без avgPrice (newOrderRespType по умолчанию) — не ошибка формата", () => {
    const { avgPrice: _, ...noAvg } = stopNew;
    expect(coinmOrderSchema.parse(noAvg).avgPrice).toBe(0);
  });

  it("открытые ордера: условные — в algos (свои ноги), остальные — обычные", () => {
    const open = coinmOrdersSchema.parse([
      stopNew,
      { ...stopNew, orderId: 7, type: "LIMIT", origType: "LIMIT" },
    ]);
    expect(splitCoinmOpenOrders(open)).toEqual({
      orders: [
        {
          orderId: 7,
          side: "SELL",
          positionSide: "LONG",
          type: "LIMIT",
          reduceOnly: true,
          closePosition: false,
        },
      ],
      algos: [
        {
          algoId: 4535901846,
          clientAlgoId: "bdprobe76932-S",
          symbol: "BTCUSD_PERP",
          side: "SELL",
          positionSide: "LONG",
          orderType: "STOP_MARKET",
        },
      ],
    });
    expect(coinmOrderSchema.parse(entryFilled).executedQty).toBe(1);
  });

  it("пара позиций: BTCUSD_PERP → BTCUSD", () => {
    expect(coinmPair("BTCUSD_PERP")).toBe("BTCUSD");
    expect(coinmPair("ETHUSD_PERP")).toBe("ETHUSD");
  });
});

describe("exchangeInfo demo-dapi → правила COIN-M", () => {
  // Фрагмент /dapi/v1/exchangeInfo 2026-10-17: статус — contractStatus, размер контракта и монета маржи.
  const btcPerp = {
    symbol: "BTCUSD_PERP",
    pair: "BTCUSD",
    contractType: "PERPETUAL",
    contractStatus: "TRADING",
    marginAsset: "BTC",
    contractSize: 100,
    filters: [
      {
        maxPrice: "2868732",
        minPrice: "2099",
        filterType: "PRICE_FILTER",
        tickSize: "0.1",
      },
      {
        maxQty: "1000000",
        filterType: "LOT_SIZE",
        stepSize: "1",
        minQty: "1",
      },
      {
        filterType: "PERCENT_PRICE",
        multiplierDecimal: "4",
        multiplierUp: "1.1000",
        multiplierDown: "0.9000",
      },
    ],
  };

  it("правила: шаг 1 контракт, без коридора цены, контракт $100 с маржой в BTC", () => {
    const [s] = exchangeInfoSchema.parse({ symbols: [btcPerp] }).symbols;
    expect(toRules("coinm", s)).toEqual({
      tickSize: "0.1",
      stepSize: "1",
      minQty: 1,
      minNotional: 0,
      priceBand: null,
      otoAllowed: false,
      ocoAllowed: false,
      contract: { size: 100, marginAsset: "BTC" },
    });
  });

  it("без размера контракта COIN-M не торгуется", () => {
    const { contractSize: _, ...noSize } = btcPerp;
    const [s] = exchangeInfoSchema.parse({ symbols: [noSize] }).symbols;
    expect(toRules("coinm", s)).toBeNull();
  });
});
