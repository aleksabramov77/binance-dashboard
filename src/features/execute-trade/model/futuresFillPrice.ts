import {
  fetchDemoFills,
  fetchDemoFuturesOrder,
} from "@/shared/api/binance/demo.server";
import type {
  TradeVenue,
  VenueFuturesMarket,
} from "@/shared/api/binance/venue.server";
import { log } from "@/shared/lib/logger.server";
import { groupFills } from "../lib/groupFills";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Фактическая цена исполнения рыночного ордера фьючерсов, если в ответе нет avgPrice (демо шлёт 0
 * с newOrderRespType=RESULT — проверено 2026-10-15 на закрытии ADAUSDT):
 * ордер по orderId, затем его исполнения (userTrades). null — узнать не удалось (берём текущую).
 * COIN-M (spec 0056): POST и вовсе без avgPrice, а GET ордера его отдаёт (проба 2026-10-17) — только ордер.
 */
export async function futuresFillPrice(
  venue: TradeVenue,
  symbol: string,
  orderId: number,
  market: VenueFuturesMarket = "usdm",
): Promise<number | null> {
  try {
    const order = await fetchDemoFuturesOrder(
      venue,
      symbol,
      { orderId },
      market,
    );
    if (order && order.avgPrice > 0) return order.avgPrice;
    if (market === "coinm") return null;
    const fills = await fetchDemoFills(venue, "usdm", symbol, 50);
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
