import type { ExecutedOrder } from "@/entities/trade";
import type { DemoFill } from "@/shared/api/binance/demo.server";

/** Складывает исполнения в ордера (один ордер — много fills); новые сверху. */
export function groupFills(fills: DemoFill[], limit: number): ExecutedOrder[] {
  const byOrder = new Map<string, { last: number; order: ExecutedOrder }>();
  for (const f of fills) {
    const id = `${f.market}-${f.symbol}-${f.orderId}`;
    let entry = byOrder.get(id);
    if (!entry) {
      entry = {
        last: f.time,
        order: {
          id,
          market: f.market,
          symbol: f.symbol,
          side: f.side,
          at: "",
          quantity: 0,
          avgPrice: 0,
          quoteQty: 0,
          commissions: [],
          realizedPnl: f.realizedPnl === null ? null : 0,
        },
      };
      byOrder.set(id, entry);
    }
    const { order } = entry;
    entry.last = Math.max(entry.last, f.time);
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
    .sort((a, b) => b.last - a.last)
    .slice(0, limit)
    .map(({ last, order }) => ({
      ...order,
      at: new Date(last).toISOString(),
      avgPrice: order.quantity > 0 ? order.quoteQty / order.quantity : 0,
    }));
}
