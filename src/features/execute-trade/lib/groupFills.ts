import type { DemoFill } from "@/shared/api/binance/demo.server";

/** Все fills одного ордера, сложенные вместе. */
export interface OrderAggregate {
  market: DemoFill["market"];
  symbol: string;
  orderId: number;
  side: DemoFill["side"];
  /** Время последнего исполнения, unix ms. */
  time: number;
  quantity: number;
  avgPrice: number;
  quoteQty: number;
  commissions: { asset: string; amount: number }[];
  /** Только фьючерсы: realized PnL от Binance. */
  realizedPnl: number | null;
}

export const orderKey = (
  o: Pick<OrderAggregate, "market" | "symbol" | "orderId">,
) => `${o.market}-${o.symbol}-${o.orderId}`;

/** Складывает исполнения в ордера (один ордер — много fills); новые сверху. */
export function groupFills(fills: DemoFill[]): OrderAggregate[] {
  const byOrder = new Map<string, OrderAggregate>();
  for (const f of fills) {
    const key = orderKey(f);
    let order = byOrder.get(key);
    if (!order) {
      order = {
        market: f.market,
        symbol: f.symbol,
        orderId: f.orderId,
        side: f.side,
        time: f.time,
        quantity: 0,
        avgPrice: 0,
        quoteQty: 0,
        commissions: [],
        realizedPnl: f.realizedPnl === null ? null : 0,
      };
      byOrder.set(key, order);
    }
    order.time = Math.max(order.time, f.time);
    order.quantity += f.qty;
    order.quoteQty += f.quoteQty;
    if (order.realizedPnl !== null) order.realizedPnl += f.realizedPnl ?? 0;
    const fee = order.commissions.find((c) => c.asset === f.commissionAsset);
    if (fee) fee.amount += f.commission;
    else
      order.commissions.push({
        asset: f.commissionAsset,
        amount: f.commission,
      });
  }
  return [...byOrder.values()]
    .map((o) => ({
      ...o,
      avgPrice: o.quantity > 0 ? o.quoteQty / o.quantity : 0,
    }))
    .sort((a, b) => b.time - a.time);
}
