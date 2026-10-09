import type { EarnProduct } from "@/shared/api/binance";
import { isStablecoin } from "@/shared/config";
import type { Offer } from "./schema";

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

export function normalizeProducts(
  products: EarnProduct[],
  prices: Map<string, number>,
): Offer[] {
  return products.flatMap((product) =>
    product.productDetailList
      .filter((d) => d.status === "ENABLE")
      .map((d): Offer => {
        const tiers = (d.apyTierOption ?? []).map((t) => ({
          from: t.beginAmount,
          to: t.endAmount,
          bonusApr: t.ratio,
        }));
        const maxBonus = Math.max(0, ...tiers.map((t) => t.bonusApr));
        const type =
          d.productType === "LENDING_FLEXIBLE" ? "flexible" : "locked";
        return {
          id: `${d.productId}:${type}:${d.duration}`,
          asset: product.asset,
          type,
          durationDays: d.duration,
          maxApr: d.apy,
          baseApr: d.marketApr ?? Math.max(0, d.apy - maxBonus),
          tiers,
          minPurchase: d.minPurchaseAmount,
          maxPerUser: d.maxPurchaseAmountPerUser,
          soldOut: d.sellOut,
          stablecoin: isStablecoin(product.asset),
          priceUsd: resolveUsdPrice(product.asset, prices),
        };
      }),
  );
}
