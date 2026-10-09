import type { TradeOverview } from "@/entities/trade";
import { fetchDemoUsdtBalances } from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { readRecentTrades } from "../api/tradeLog";

export async function getTradeOverview(): Promise<TradeOverview> {
  const config = getDemoTradingConfig();
  const trades = await readRecentTrades();
  if (!config)
    return {
      configured: false,
      maxNotionalUsd: 0,
      balances: null,
      error: null,
      trades,
    };
  try {
    const balances = await fetchDemoUsdtBalances(config.credentials);
    return {
      configured: true,
      maxNotionalUsd: config.maxNotionalUsd,
      balances,
      error: null,
      trades,
    };
  } catch (error) {
    return {
      configured: true,
      maxNotionalUsd: config.maxNotionalUsd,
      balances: null,
      error: error instanceof Error ? error.message : String(error),
      trades,
    };
  }
}
