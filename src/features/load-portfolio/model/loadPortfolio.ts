import type { Holding, Portfolio } from "@/entities/holding";
import { resolveUsdPrice } from "@/shared/api/binance";
import {
  fetchFlexiblePositions,
  fetchFundingAssets,
  fetchLockedPositions,
  fetchSpotAccount,
  fetchWalletBalances,
} from "@/shared/api/binance/account.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import {
  getBinanceCredentials,
  isServerless,
} from "@/shared/config/env.server";
import { aprWithTiers } from "./tierApr";

const DUST_USD = 0.01;

export async function loadPortfolio(): Promise<Portfolio> {
  const creds = getBinanceCredentials();
  // В облаке ключа реального аккаунта нет намеренно (решение владельца 2026-10-10, docs/ai/deploy-supabase.md).
  if (!creds)
    return {
      status: "not-configured",
      hosting: isServerless() ? "cloud" : "local",
    };

  try {
    const [spot, funding, flexible, locked, wallets, prices] =
      await Promise.all([
        fetchSpotAccount(creds),
        fetchFundingAssets(creds),
        fetchFlexiblePositions(creds),
        fetchLockedPositions(creds),
        fetchWalletBalances(creds),
        fetchTickerPrices(),
      ]);
    const price = (asset: string) => resolveUsdPrice(asset, prices);
    const base = { productId: null, durationDays: null, until: null, apr: 0 };
    const flexibleAssets = new Set(flexible.map((p) => p.asset));

    const holdings: Holding[] = [
      ...spot.balances
        // Старые «LD»-токены Simple Earn дублируют Flexible-позиции.
        .filter(
          (b) =>
            !(b.asset.startsWith("LD") && flexibleAssets.has(b.asset.slice(2))),
        )
        .map((b) => ({
          ...base,
          asset: b.asset,
          place: "spot" as const,
          amount: b.free,
          frozen: b.locked,
          priceUsd: price(b.asset),
        })),
      ...funding.map((f) => ({
        ...base,
        asset: f.asset,
        place: "funding" as const,
        amount: f.free,
        frozen: f.locked + f.freeze,
        priceUsd: price(f.asset),
      })),
      ...flexible.map((p) => ({
        ...base,
        asset: p.asset,
        place: "flexible" as const,
        amount: p.totalAmount,
        frozen: 0,
        priceUsd: price(p.asset),
        apr: aprWithTiers(
          p.latestAnnualPercentageRate,
          p.tierAnnualPercentageRate,
          p.totalAmount,
        ),
        productId: p.productId,
      })),
      ...locked.map((p) => ({
        asset: p.asset,
        place: "locked" as const,
        amount: 0,
        frozen: p.amount,
        priceUsd: price(p.asset),
        apr: p.APY + (p.extraRewardAPR ?? 0) + (p.boostApr ?? 0),
        productId: p.projectId,
        durationDays: p.duration,
        until: p.deliverDate ? new Date(p.deliverDate).toISOString() : null,
      })),
    ].filter((h) => (h.amount + h.frozen) * (h.priceUsd ?? 1) >= DUST_USD);

    return {
      status: "ok",
      fetchedAt: new Date().toISOString(),
      holdings,
      wallets: wallets
        .filter((w) => w.balance > 0)
        .map((w) => ({ name: w.walletName, balanceUsd: w.balance })),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
