import type { ExecutedOrder, TradeHistory } from "@/entities/trade";
import type { Market } from "@/shared/api/binance";
import {
  type DemoPosition,
  type DemoSymbolOrders,
  fetchDemoFills,
  fetchDemoFuturesPositions,
  fetchDemoSpotHoldings,
  fetchDemoSymbolOrders,
  fetchDemoTradedSymbols,
} from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { splitSymbol } from "@/shared/lib";
import { log } from "@/shared/lib/logger.server";
import { groupFills, type OrderAggregate, orderKey } from "../lib/groupFills";
import {
  markTrades,
  type OrderMark,
  type SymbolState,
} from "../lib/markTrades";

const ORDERS_LIMIT = 30;
/** Защита от лавины запросов: на символ уходит 2–3 запроса по 5–20 веса. */
const SYMBOLS_LIMIT = 40;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const settledValue = <T>(r: PromiseSettledResult<T>): T | null =>
  r.status === "fulfilled" ? r.value : null;

/** Состояние символа на бирже; не загрузилось что-то нужное — null («статус неизвестен»). */
function symbolState(
  market: Market,
  symbol: string,
  orders: DemoSymbolOrders | null,
  positions: Map<string, DemoPosition> | null,
  holdings: Map<string, number> | null,
): SymbolState | null {
  if (!orders) return null;
  if (market === "futures") {
    if (!positions) return null;
    const p = positions.get(symbol);
    return {
      ...orders,
      position: p
        ? {
            amount: p.amount,
            entryPrice: p.entryPrice,
            unrealizedPnl: p.unrealizedPnl,
          }
        : null,
    };
  }
  if (!holdings) return null;
  const amount = holdings.get(splitSymbol(symbol).base) ?? 0;
  return {
    ...orders,
    position:
      amount > 0 ? { amount, entryPrice: null, unrealizedPnl: null } : null,
  };
}

/**
 * История сделок берётся с демо-счёта Binance, локально ничего не хранится.
 * Каждому ордеру — статус его сделки (TP / SL / вручную / открыта …).
 */
export async function getTradeHistory(): Promise<TradeHistory> {
  const config = getDemoTradingConfig();
  if (!config) return { configured: false, error: null, orders: [] };
  const creds = config.credentials;

  let symbols: Record<Market, string[]>;
  try {
    symbols = await fetchDemoTradedSymbols(creds);
  } catch (error) {
    return { configured: true, error: errorText(error), orders: [] };
  }

  const pairs = (["spot", "futures"] as const)
    .flatMap((market) => symbols[market].map((symbol) => ({ market, symbol })))
    .slice(0, SYMBOLS_LIMIT);
  const [fillResults, orderResults, positionsResult, holdingsResult] =
    await Promise.all([
      Promise.allSettled(
        pairs.map((p) => fetchDemoFills(creds, p.market, p.symbol)),
      ),
      Promise.allSettled(
        pairs.map((p) => fetchDemoSymbolOrders(creds, p.market, p.symbol)),
      ),
      Promise.allSettled([fetchDemoFuturesPositions(creds)]),
      Promise.allSettled([fetchDemoSpotHoldings(creds)]),
    ]);
  const positions = settledValue(positionsResult[0]);
  const holdings = settledValue(holdingsResult[0]);
  for (const r of [...positionsResult, ...holdingsResult])
    if (r.status === "rejected")
      log.warn("trade.history", `позиции/баланс: ${errorText(r.reason)}`);

  const failed: string[] = [];
  const orders: ExecutedOrder[] = [];
  pairs.forEach(({ market, symbol }, i) => {
    const fills = fillResults[i];
    if (fills.status === "rejected") {
      failed.push(symbol);
      log.warn("trade.history", `${symbol}: ${errorText(fills.reason)}`);
      return;
    }
    const symbolOrders = orderResults[i];
    if (symbolOrders.status === "rejected")
      log.warn(
        "trade.history",
        `${symbol}: статусы не загрузились — ${errorText(symbolOrders.reason)}`,
      );
    const aggregates = groupFills(fills.value);
    const marks = markTrades(
      aggregates,
      symbolState(
        market,
        symbol,
        settledValue(symbolOrders),
        positions,
        holdings,
      ),
    );
    for (const o of aggregates)
      orders.push(toExecutedOrder(o, marks.get(o.orderId)));
  });

  return {
    configured: true,
    error: failed.length
      ? `Не загрузилась история по ${failed.join(", ")} — попробуйте обновить.`
      : null,
    orders: orders
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, ORDERS_LIMIT),
  };
}

function toExecutedOrder(
  o: OrderAggregate,
  mark: OrderMark | undefined,
): ExecutedOrder {
  return {
    id: orderKey(o),
    market: o.market,
    symbol: o.symbol,
    side: o.side,
    at: new Date(o.time).toISOString(),
    quantity: o.quantity,
    avgPrice: o.avgPrice,
    quoteQty: o.quoteQty,
    commissions: o.commissions,
    // Spot: PnL выхода считаем от средней цены входа; у входа PnL нет.
    realizedPnl:
      o.market === "futures"
        ? o.realizedPnl
        : mark?.role === "exit"
          ? mark.pnl
          : null,
    trade: {
      status: mark?.status ?? "unknown",
      role: mark?.role ?? (o.side === "BUY" ? "entry" : "exit"),
      stopPrice: mark?.stopPrice ?? null,
      unrealizedPnl: mark?.unrealizedPnl ?? null,
    },
  };
}
