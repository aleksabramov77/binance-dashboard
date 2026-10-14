import { describe, expect, it } from "vitest";
import { spotEntryListRequest, summarizeSpotEntryList } from "./demoOrderLists";
import { orderListReportsSchema } from "./demoSchemas";

const base = {
  symbol: "BATUSDT",
  quantity: "40",
  limitPrice: "0.1711",
  sellQuantity: "39",
  stopLoss: "0.1450",
};

describe("spotEntryListRequest", () => {
  it("с тейком — OTOCO: LIMIT FOK на покупку, тейк LIMIT_MAKER выше, STOP_LOSS ниже", () => {
    expect(spotEntryListRequest({ ...base, takeProfit: "0.2200" })).toEqual({
      path: "/api/v3/orderList/otoco",
      params: {
        symbol: "BATUSDT",
        workingType: "LIMIT",
        workingSide: "BUY",
        workingPrice: "0.1711",
        workingQuantity: "40",
        workingTimeInForce: "FOK",
        pendingSide: "SELL",
        pendingQuantity: "39",
        newOrderRespType: "FULL",
        pendingAboveType: "LIMIT_MAKER",
        pendingAbovePrice: "0.2200",
        pendingBelowType: "STOP_LOSS",
        pendingBelowStopPrice: "0.1450",
      },
    });
  });

  it("без тейка — OTO: только STOP_LOSS", () => {
    const { path, params } = spotEntryListRequest({
      ...base,
      takeProfit: null,
    });
    expect(path).toBe("/api/v3/orderList/oto");
    expect(params).toMatchObject({
      pendingType: "STOP_LOSS",
      pendingStopPrice: "0.1450",
      pendingQuantity: "39",
    });
    expect(params).not.toHaveProperty("pendingAboveType");
  });

  it("свои id списка и ордеров — чтобы перечитать заявку с неизвестным исходом", () => {
    const clientIds = {
      list: "bd1-L",
      working: "bd1-W",
      stop: "bd1-S",
      takeProfit: "bd1-T",
    };
    expect(
      spotEntryListRequest({ ...base, takeProfit: "0.2200", clientIds }).params,
    ).toMatchObject({
      listClientOrderId: "bd1-L",
      workingClientOrderId: "bd1-W",
      pendingAboveClientOrderId: "bd1-T",
      pendingBelowClientOrderId: "bd1-S",
    });
    const oto = spotEntryListRequest({ ...base, takeProfit: null, clientIds });
    expect(oto.params).toMatchObject({
      listClientOrderId: "bd1-L",
      workingClientOrderId: "bd1-W",
      pendingClientOrderId: "bd1-S",
    });
    expect(oto.params).not.toHaveProperty("pendingAboveClientOrderId");
  });
});

describe("summarizeSpotEntryList", () => {
  it("разбирает реальный ответ демо-спота на OTOCO (2026-10-15)", () => {
    const res = orderListReportsSchema.parse({
      orderListId: 4284403,
      contingencyType: "OTO",
      listStatusType: "EXEC_STARTED",
      listOrderStatus: "EXECUTING",
      symbol: "BATUSDT",
      orderReports: [
        {
          orderId: 98392308,
          type: "LIMIT",
          side: "BUY",
          status: "FILLED",
          origQty: "40.00000000",
          executedQty: "40.00000000",
          cummulativeQuoteQty: "6.82000000",
          fills: [
            {
              price: "0.17050000",
              qty: "40.00000000",
              commission: "0.04000000",
              commissionAsset: "BAT",
            },
          ],
        },
        {
          orderId: 98392309,
          type: "STOP_LOSS",
          side: "SELL",
          status: "PENDING_NEW",
          origQty: "39.00000000",
          executedQty: "0.00000000",
          cummulativeQuoteQty: "0.00000000",
          fills: [],
        },
        {
          orderId: 98392310,
          type: "LIMIT_MAKER",
          side: "SELL",
          status: "PENDING_NEW",
          origQty: "39.00000000",
          executedQty: "0.00000000",
          cummulativeQuoteQty: "0.00000000",
          fills: [],
        },
      ],
    });
    expect(summarizeSpotEntryList(res, "BAT")).toEqual({
      orderListId: 4284403,
      workingStatus: "FILLED",
      workingOrderId: 98392308,
      filled: 40,
      quoteQty: 6.82,
      baseCommission: 0.04,
      pending: [
        { orderId: 98392309, type: "STOP_LOSS", status: "PENDING_NEW" },
        { orderId: 98392310, type: "LIMIT_MAKER", status: "PENDING_NEW" },
      ],
    });
  });
});
