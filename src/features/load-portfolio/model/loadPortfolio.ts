import type { Holding, Portfolio } from "@/entities/holding";
import { resolveUsdPrice } from "@/shared/api/binance";
import {
  fetchFlexiblePositions,
  fetchFlexibleRewards,
  fetchFundingAssets,
  fetchLockedPositions,
  fetchLockedRewards,
  fetchSpotAccount,
  fetchWalletBalances,
} from "@/shared/api/binance/account.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import {
  type BinanceCredentials,
  getBinanceCredentials,
  isServerless,
} from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { createKeyedCache } from "./keyedCache";
import { aprWithTiers } from "./tierApr";
import {
  rewardsCacheTtlMs,
  sumYesterdayRewardsUsd,
  type YesterdayRewards,
  yesterdayUsdFor,
  yesterdayUtcRange,
} from "./yesterdayRewards";

const DUST_USD = 0.01;

/**
 * Кэш наград за вчера (ключ — начало окна): повторные загрузки портфеля не ходят в историю (вес 150 на запрос, IP
 * Vercel уже банили за 429/418 — задача 0014). Первые часы суток ответ ещё дозревает — кэш короткий, потом — до
 * следующей полуночи UTC (`rewardsCacheTtlMs`).
 */
const rewardsCache = createKeyedCache<number, YesterdayRewards>();

function loadYesterdayRewards(
  creds: BinanceCredentials,
  now: Date,
): Promise<YesterdayRewards> {
  const { startTime, endTime } = yesterdayUtcRange(now);
  // endTime у Binance включительно: последняя миллисекунда суток, чтобы не захватить начисления сегодняшней полуночи.
  const window = { startTime, endTime: endTime - 1 };
  return rewardsCache.get(
    startTime,
    async () => {
      const [flexible, locked] = await Promise.all([
        fetchFlexibleRewards(creds, { ...window, type: "ALL" }),
        fetchLockedRewards(creds, window),
      ]);
      return { flexible, locked };
    },
    { now: now.getTime(), ttlMs: rewardsCacheTtlMs(now) },
  );
}

export async function loadPortfolio(): Promise<Portfolio> {
  const creds = getBinanceCredentials();
  // Без ключа — инструкция по подключению; облачный хостинг отличается только полем hosting.
  if (!creds)
    return {
      status: "not-configured",
      hosting: isServerless() ? "cloud" : "local",
    };

  try {
    // Сбой истории начислений не роняет портфель: «Вчера» тогда пустое у всех строк.
    const rewardsRequest = loadYesterdayRewards(creds, new Date()).catch(
      (error: unknown) => {
        log.warn(
          "portfolio.rewards",
          "История начислений Earn за вчера не загрузилась",
          undefined,
          error,
        );
        return null;
      },
    );
    const [spot, funding, flexible, locked, wallets, prices, rewards] =
      await Promise.all([
        fetchSpotAccount(creds),
        fetchFundingAssets(creds),
        fetchFlexiblePositions(creds),
        fetchLockedPositions(creds),
        fetchWalletBalances(creds),
        fetchTickerPrices(),
        rewardsRequest,
      ]);
    const price = (asset: string) => resolveUsdPrice(asset, prices);
    const rewardsUsd = rewards && sumYesterdayRewardsUsd(rewards, price);
    const base = {
      productId: null,
      positionId: null,
      durationDays: null,
      until: null,
      apr: 0,
      yesterdayUsd: null,
    };
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
        positionId: null,
        durationDays: null,
        until: null,
        yesterdayUsd: yesterdayUsdFor(
          {
            asset: p.asset,
            place: "flexible",
            productId: p.productId,
            positionId: null,
          },
          rewardsUsd,
        ),
      })),
      ...locked.map((p) => ({
        asset: p.asset,
        place: "locked" as const,
        amount: 0,
        frozen: p.amount,
        priceUsd: price(p.asset),
        apr: p.APY + (p.extraRewardAPR ?? 0) + (p.boostApr ?? 0),
        productId: p.projectId,
        positionId: p.positionId,
        durationDays: p.duration,
        until: p.deliverDate ? new Date(p.deliverDate).toISOString() : null,
        yesterdayUsd: yesterdayUsdFor(
          {
            asset: p.asset,
            place: "locked",
            productId: p.projectId,
            positionId: p.positionId,
          },
          rewardsUsd,
        ),
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
