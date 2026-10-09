import { isStablecoin } from "@/shared/config";

const QUOTES = ["USDT", "USDC", "FDUSD"] as const;

/** Цена актива в USD по спотовым парам; для стейблкоинов без пары — 1. */
export function resolveUsdPrice(
  asset: string,
  prices: Map<string, number>,
): number | null {
  if (asset === "USDT") return 1;
  for (const quote of QUOTES) {
    const price = prices.get(`${asset}${quote}`);
    if (price) return price;
  }
  const inBtc = prices.get(`${asset}BTC`);
  const btc = prices.get("BTCUSDT");
  if (inBtc && btc) return inBtc * btc;
  return isStablecoin(asset) ? 1 : null;
}
