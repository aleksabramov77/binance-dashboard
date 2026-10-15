import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import {
  type FlexiblePosition,
  type FlexibleReward,
  type FundingAsset,
  flexiblePositionsSchema,
  flexibleRewardsSchema,
  fundingAssetsSchema,
  type LockedPosition,
  type LockedReward,
  lockedPositionsSchema,
  lockedRewardsSchema,
  type SpotAccount,
  spotAccountSchema,
  type WalletBalance,
  walletBalancesSchema,
} from "./accountSchemas";
import { type SignedParams, signedRequest as signed } from "./signed";

const API_URL = "https://api.binance.com";
const PAGE_SIZE = 100;

/** Чтение боевого аккаунта (read-only ключ). */
function signedRequest<T extends z.ZodType>(
  creds: BinanceCredentials,
  method: "GET" | "POST",
  path: string,
  schema: T,
  params: SignedParams = {},
): Promise<z.infer<T>> {
  return signed(API_URL, creds, method, path, schema, params);
}

export async function fetchSpotAccount(
  creds: BinanceCredentials,
): Promise<SpotAccount> {
  return signedRequest(creds, "GET", "/api/v3/account", spotAccountSchema, {
    omitZeroBalances: "true",
  });
}

export async function fetchFundingAssets(
  creds: BinanceCredentials,
): Promise<FundingAsset[]> {
  return signedRequest(
    creds,
    "POST",
    "/sapi/v1/asset/get-funding-asset",
    fundingAssetsSchema,
  );
}

export async function fetchWalletBalances(
  creds: BinanceCredentials,
): Promise<WalletBalance[]> {
  return signedRequest(
    creds,
    "GET",
    "/sapi/v1/asset/wallet/balance",
    walletBalancesSchema,
    {
      quoteAsset: "USDT",
    },
  );
}

async function fetchAllPages<Row>(
  load: (current: number) => Promise<{ total: number; rows: Row[] }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let current = 1; ; current++) {
    const page = await load(current);
    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE || rows.length >= page.total) return rows;
  }
}

export async function fetchFlexiblePositions(
  creds: BinanceCredentials,
): Promise<FlexiblePosition[]> {
  return fetchAllPages((current) =>
    signedRequest(
      creds,
      "GET",
      "/sapi/v1/simple-earn/flexible/position",
      flexiblePositionsSchema,
      {
        current,
        size: PAGE_SIZE,
      },
    ),
  );
}

export async function fetchLockedPositions(
  creds: BinanceCredentials,
): Promise<LockedPosition[]> {
  return fetchAllPages((current) =>
    signedRequest(
      creds,
      "GET",
      "/sapi/v1/simple-earn/locked/position",
      lockedPositionsSchema,
      {
        current,
        size: PAGE_SIZE,
      },
    ),
  );
}

/** Окно истории начислений, мс; Binance принимает не больше 30 дней. */
export type RewardsWindow = { startTime: number; endTime: number };

/**
 * Вид начислений Flexible: `BONUS` — бонусная ступень ставки, `REALTIME` — базовая ставка, `REWARDS` — старая
 * история, `ALL` — все сразу (одним запросом вместо трёх: вес у каждого 150). Параметр обязателен.
 */
export type FlexibleRewardsType = "ALL" | "BONUS" | "REALTIME" | "REWARDS";

export async function fetchFlexibleRewards(
  creds: BinanceCredentials,
  { startTime, endTime, type }: RewardsWindow & { type: FlexibleRewardsType },
): Promise<FlexibleReward[]> {
  return fetchAllPages((current) =>
    signedRequest(
      creds,
      "GET",
      "/sapi/v1/simple-earn/flexible/history/rewardsRecord",
      flexibleRewardsSchema,
      { startTime, endTime, type, current, size: PAGE_SIZE },
    ),
  );
}

export async function fetchLockedRewards(
  creds: BinanceCredentials,
  { startTime, endTime }: RewardsWindow,
): Promise<LockedReward[]> {
  return fetchAllPages((current) =>
    signedRequest(
      creds,
      "GET",
      "/sapi/v1/simple-earn/locked/history/rewardsRecord",
      lockedRewardsSchema,
      { startTime, endTime, current, size: PAGE_SIZE },
    ),
  );
}
