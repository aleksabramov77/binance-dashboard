import { describe, expect, it } from "vitest";
import type { DemoFill } from "@/shared/api/binance/demo.server";
import { groupFills, orderKey } from "./groupFills";

const fill = (over: Partial<DemoFill>): DemoFill => ({
  market: "futures",
  symbol: "BATUSDT",
  orderId: 1,
  time: 1_000,
  side: "SELL",
  price: 1,
  qty: 1,
  quoteQty: 1,
  commission: 0.001,
  commissionAsset: "USDT",
  realizedPnl: 0,
  ...over,
});

describe("groupFills", () => {
  it("складывает fills одного ордера и считает среднюю цену", () => {
    const [order] = groupFills([
      fill({ qty: 10, price: 2, quoteQty: 20, time: 1_000 }),
      fill({ qty: 30, price: 4, quoteQty: 120, time: 1_500 }),
    ]);
    expect(order.quantity).toBe(40);
    expect(order.quoteQty).toBe(140);
    expect(order.avgPrice).toBe(3.5);
    expect(order.time).toBe(1_500);
    expect(order.commissions).toEqual([{ asset: "USDT", amount: 0.002 }]);
  });

  it("суммирует PnL фьючерсов, у спота PnL нет", () => {
    const orders = groupFills([
      fill({ orderId: 2, side: "BUY", realizedPnl: -1.5 }),
      fill({ orderId: 2, side: "BUY", realizedPnl: -0.5 }),
      fill({
        market: "spot",
        symbol: "ETHUSDT",
        orderId: 2,
        realizedPnl: null,
        commissionAsset: "ETH",
      }),
    ]);
    expect(orders).toHaveLength(2);
    expect(orders.find((o) => o.market === "futures")?.realizedPnl).toBe(-2);
    expect(orders.find((o) => o.market === "spot")?.realizedPnl).toBeNull();
  });

  it("сортирует новые сверху", () => {
    const orders = groupFills([
      fill({ orderId: 1, time: 1 }),
      fill({ orderId: 2, time: 3 }),
      fill({ orderId: 3, time: 2 }),
    ]);
    expect(orders.map(orderKey)).toEqual([
      "futures-BATUSDT-2",
      "futures-BATUSDT-3",
      "futures-BATUSDT-1",
    ]);
  });
});
