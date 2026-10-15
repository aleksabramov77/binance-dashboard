import {
  type DualProduct,
  type EarnOverviewAsset,
  type OnchainYieldsProduct,
  type RatePoint,
  resolveUsdPrice,
  type SoftStakingProduct,
  type StableYieldQuota,
  type StakingQuota,
} from "@/shared/api/binance";
import type { DualOffer, EarnKind, KindSummary, YieldProduct } from "./schema";

const toIso = (ms: number) => new Date(ms).toISOString();

/**
 * Dual Investment → предложения. CALL: вкладывается монета (investCoin), страйк выше цены — «Sell High».
 * PUT: вкладывается стейбл, страйк ниже цены — «Buy Low» (сверено пробой 2026-10-15).
 */
export function normalizeDualProducts(
  products: DualProduct[],
  prices: Map<string, number>,
): DualOffer[] {
  return products.map((p) => {
    const sellHigh = p.optionType === "CALL";
    const coin = sellHigh ? p.investCoin : p.exercisedCoin;
    const stable = sellHigh ? p.exercisedCoin : p.investCoin;
    return {
      id: `dual:${p.id}`,
      side: sellHigh ? "sell-high" : "buy-low",
      coin,
      stable,
      strikePrice: p.strikePrice,
      apr: p.apr,
      durationDays: p.duration,
      settleAt: toIso(p.settleDate),
      purchaseEndAt: toIso(p.purchaseEndTime),
      minAmount: p.minAmount,
      maxAmount: p.maxAmount,
      canPurchase: p.canPurchase,
      price: prices.get(`${coin}${stable}`) ?? resolveUsdPrice(coin, prices),
    };
  });
}

export function normalizeOnchainProducts(
  rows: OnchainYieldsProduct[],
  prices: Map<string, number>,
): YieldProduct[] {
  return rows.map(({ projectId, detail, quota }) => ({
    id: `onchain:${projectId}`,
    kind: "onchain",
    name: projectId,
    asset: detail.asset,
    rewardAsset:
      detail.rewardAsset && detail.rewardAsset !== detail.asset
        ? detail.rewardAsset
        : null,
    apr: detail.apr,
    lockDays: detail.duration,
    redemptionDays: null,
    minPurchase: quota?.minimum ?? null,
    quotaLeft: quota?.totalPersonalQuota ?? null,
    soldOut:
      detail.isSoldOut === true ||
      (detail.status !== undefined && detail.status !== "PURCHASING"),
    priceUsd: resolveUsdPrice(detail.asset, prices),
  }));
}

const STAKING = {
  "eth-staking": { asset: "ETH", reward: "WBETH", name: "ETH Staking" },
  "sol-staking": { asset: "SOL", reward: "BNSOL", name: "SOL Staking" },
} as const;

/** ETH/SOL staking — один продукт: ставка из rateHistory, условия из quota. */
export function stakingProduct(
  kind: keyof typeof STAKING,
  quota: StakingQuota,
  rate: RatePoint | null,
  prices: Map<string, number>,
): YieldProduct {
  const { asset, reward, name } = STAKING[kind];
  return {
    id: kind,
    kind,
    name,
    asset,
    rewardAsset: reward,
    apr: rate?.annualPercentageRate ?? null,
    lockDays: null,
    redemptionDays: quota.redeemPeriod ?? null,
    minPurchase: quota.minStakeAmount ?? null,
    quotaLeft: quota.leftStakingPersonalQuota ?? null,
    soldOut: quota.soldOut === true || quota.stakeable === false,
    priceUsd: resolveUsdPrice(asset, prices),
  };
}

/** RWUSD / BFUSD — один продукт на стейблах. */
export function stableYieldProduct(
  kind: "rwusd" | "bfusd",
  quota: StableYieldQuota,
  rate: RatePoint | null,
): YieldProduct {
  return {
    id: kind,
    kind,
    name: kind.toUpperCase(),
    asset: "USDT",
    rewardAsset: null,
    apr: rate?.annualPercentageRate ?? null,
    lockDays: null,
    redemptionDays: quota.standardRedemptionQuota?.redeemPeriod ?? null,
    minPurchase: quota.subscriptionQuota?.minimum ?? null,
    quotaLeft: quota.subscriptionQuota?.leftQuota ?? null,
    soldOut: quota.subscribeEnable === false,
    priceUsd: 1,
  };
}

export function normalizeSoftStaking(
  rows: SoftStakingProduct[],
  prices: Map<string, number>,
): YieldProduct[] {
  return rows.map((row) => ({
    id: `soft-staking:${row.asset}`,
    kind: "soft-staking",
    name: `${row.asset} Soft Staking`,
    asset: row.asset,
    rewardAsset: null,
    apr: row.apr,
    lockDays: null,
    redemptionDays: 0,
    minPurchase: row.minAmount ?? null,
    quotaLeft: row.maxCap ?? null,
    soldOut: false,
    priceUsd: resolveUsdPrice(row.asset, prices),
  }));
}

/** productType публичной сводки → вид гида. SIMPLE_EARN делится по duration. */
const SUMMARY_KINDS: Record<string, EarnKind> = {
  DUAL_CURRENCY: "dual",
  ON_CHAIN_YIELDS: "onchain",
  RWUSD: "rwusd",
  BFUSD: "bfusd",
  ARBITRAGE_BOT: "smart-arbitrage",
  ETH_TWO: "eth-staking",
  BN_SOL_STAKING: "sol-staking",
};

/** Публичная сводка → диапазоны ставок по видам. Неизвестный productType пропускается (bapi недокументирован). */
export function normalizeSummary(assets: EarnOverviewAsset[]): KindSummary[] {
  return assets.flatMap(({ asset, productSummary }) =>
    (productSummary ?? []).flatMap((p): KindSummary[] => {
      const { maxApr } = p;
      if (maxApr === null) return [];
      const kinds: EarnKind[] =
        p.productType === "SIMPLE_EARN"
          ? [
              ...(p.duration?.includes("FLEXIBLE")
                ? ["simple-flexible" as const]
                : []),
              ...(p.duration?.includes("FIXED")
                ? ["simple-locked" as const]
                : []),
            ]
          : SUMMARY_KINDS[p.productType]
            ? [SUMMARY_KINDS[p.productType]]
            : [];
      return kinds.map((kind) => ({
        kind,
        asset,
        minApr: p.minApr ?? maxApr,
        maxApr,
        lowRisk: p.lowRisk === true,
        soldOut: p.soldOut === true,
      }));
    }),
  );
}
