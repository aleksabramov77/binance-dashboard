import {
  fetchDemoFills,
  fetchDemoFuturesOrder,
} from "@/shared/api/binance/demo.server";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { groupFills } from "../lib/groupFills";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Фактическая цена исполнения рыночного ордера фьючерсов, если в ответе нет avgPrice (демо шлёт 0
 * с newOrderRespType=RESULT — проверено 2026-10-15 на закрытии ADAUSDT):
 * ордер по orderId, затем его исполнения (userTrades). null — узнать не удалось (берём текущую).
 */
export async function futuresFillPrice(
  creds: BinanceCredentials,
  symbol: string,
  orderId: number,
): Promise<number | null> {
  try {
    const order = await fetchDemoFuturesOrder(creds, symbol, { orderId });
    if (order && order.avgPrice > 0) return order.avgPrice;
    const fills = await fetchDemoFills(creds, "futures", symbol, 50);
    const own = groupFills(fills).find((o) => o.orderId === orderId);
    return own && own.avgPrice > 0 ? own.avgPrice : null;
  } catch (error) {
    log.warn("trade.fill_price", `${symbol}: цена исполнения не уточнена`, {
      symbol,
      orderId,
      error: errorText(error),
    });
    return null;
  }
}
