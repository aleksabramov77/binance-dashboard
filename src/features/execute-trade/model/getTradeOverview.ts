import type { TradeOverview } from "@/entities/trade";
import {
  fetchDemoOpenSymbols,
  fetchDemoUsdtBalances,
} from "@/shared/api/binance/demo.server";
import { demoVenue } from "@/shared/api/binance/venue.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function getTradeOverview(): Promise<TradeOverview> {
  const config = getDemoTradingConfig();
  if (!config)
    return {
      configured: false,
      maxNotionalUsd: 0,
      balances: null,
      openSymbols: null,
      error: null,
    };
  const venue = demoVenue(config.credentials);
  const [balances, openSymbols] = await Promise.allSettled([
    fetchDemoUsdtBalances(venue),
    fetchDemoOpenSymbols(venue),
  ]);
  // Без списка открытых сделок дашборд работает, просто не помечает сетапы.
  if (openSymbols.status === "rejected")
    log.warn(
      "trade.overview",
      `open symbols: ${errorText(openSymbols.reason)}`,
    );
  return {
    configured: true,
    maxNotionalUsd: config.maxNotionalUsd,
    balances: balances.status === "fulfilled" ? balances.value : null,
    openSymbols: openSymbols.status === "fulfilled" ? openSymbols.value : null,
    error: balances.status === "rejected" ? errorText(balances.reason) : null,
  };
}
