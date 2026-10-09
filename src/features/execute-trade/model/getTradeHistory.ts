import type { TradeHistory } from "@/entities/trade";
import type { Market } from "@/shared/api/binance";
import {
  type DemoFill,
  fetchDemoFills,
  fetchDemoTradedSymbols,
} from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { groupFills } from "../lib/groupFills";

const ORDERS_LIMIT = 30;
/** Защита от лавины запросов: myTrades/userTrades стоят по 5–20 веса каждый. */
const SYMBOLS_LIMIT = 40;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** История сделок берётся с демо-счёта Binance, локально ничего не хранится. */
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
  const results = await Promise.allSettled(
    pairs.map((p) => fetchDemoFills(creds, p.market, p.symbol)),
  );

  const fills: DemoFill[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fills.push(...r.value);
    else {
      failed.push(pairs[i].symbol);
      log.warn("trade.history", `${pairs[i].symbol}: ${errorText(r.reason)}`);
    }
  });

  return {
    configured: true,
    error: failed.length
      ? `Не загрузилась история по ${failed.join(", ")} — попробуйте обновить.`
      : null,
    orders: groupFills(fills, ORDERS_LIMIT),
  };
}
