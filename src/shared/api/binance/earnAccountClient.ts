import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import {
  type DualProduct,
  dualProductsSchema,
  type OnchainYieldsProduct,
  onchainYieldsListSchema,
  type RatePoint,
  rateHistorySchema,
  type SoftStakingProduct,
  type StableYieldQuota,
  type StakingQuota,
  softStakingListSchema,
  stableYieldQuotaSchema,
  stakingQuotaSchema,
} from "./earnAccountSchemas";
import { type SignedParams, signedRequest } from "./signed";

// Каталоги сложных продуктов Earn: только подписанные GET (USER_DATA, read-only ключ), вес 1.
const API_URL = "https://api.binance.com";
/** Максимум pageSize у dci/product/list (500 → -1102). */
const PAGE_SIZE = 100;
/** Страниц на одну пару Dual: у BTC их ~7 — дальние страйки дают копеечный APR. */
const DUAL_MAX_PAGES = 10;

function get<T extends z.ZodType>(
  creds: BinanceCredentials,
  path: string,
  schema: T,
  params: SignedParams = {},
): Promise<z.infer<T>> {
  return signedRequest(API_URL, creds, "GET", path, schema, params);
}

export interface DualPairQuery {
  /** CALL — «Sell High» (вкладывается монета), PUT — «Buy Low» (вкладывается стейбл). */
  optionType: "CALL" | "PUT";
  investCoin: string;
  exercisedCoin: string;
}

/** Все предложения Dual Investment по паре и направлению (страйки от ближнего к дальнему). */
export async function fetchDualProducts(
  creds: BinanceCredentials,
  query: DualPairQuery,
): Promise<DualProduct[]> {
  const rows: DualProduct[] = [];
  for (let pageIndex = 1; pageIndex <= DUAL_MAX_PAGES; pageIndex++) {
    const page = await get(
      creds,
      "/sapi/v1/dci/product/list",
      dualProductsSchema,
      {
        ...query,
        pageSize: PAGE_SIZE,
        pageIndex,
      },
    );
    rows.push(...page.list);
    if (page.list.length < PAGE_SIZE || rows.length >= page.total) break;
  }
  return rows;
}

export async function fetchOnchainYieldsProducts(
  creds: BinanceCredentials,
): Promise<OnchainYieldsProduct[]> {
  const page = await get(
    creds,
    "/sapi/v1/onchain-yields/locked/list",
    onchainYieldsListSchema,
    { size: PAGE_SIZE },
  );
  return page.rows;
}

export async function fetchSoftStakingList(
  creds: BinanceCredentials,
): Promise<SoftStakingProduct[]> {
  const page = await get(
    creds,
    "/sapi/v1/soft-staking/list",
    softStakingListSchema,
    { size: PAGE_SIZE },
  );
  return page.rows;
}

const STAKING_PATHS = {
  eth: {
    quota: "/sapi/v1/eth-staking/eth/quota",
    rate: "/sapi/v1/eth-staking/eth/history/rateHistory",
  },
  sol: {
    quota: "/sapi/v1/sol-staking/sol/quota",
    rate: "/sapi/v1/sol-staking/sol/history/rateHistory",
  },
} as const;

const STABLE_YIELD_PATHS = {
  rwusd: {
    quota: "/sapi/v1/rwusd/quota",
    rate: "/sapi/v1/rwusd/history/rateHistory",
  },
  bfusd: {
    quota: "/sapi/v1/bfusd/quota",
    rate: "/sapi/v1/bfusd/history/rateHistory",
  },
} as const;

/** Квота и условия стейкинга ETH/SOL через Binance (WBETH / BNSOL). */
export function fetchStakingQuota(
  creds: BinanceCredentials,
  coin: keyof typeof STAKING_PATHS,
): Promise<StakingQuota> {
  return get(creds, STAKING_PATHS[coin].quota, stakingQuotaSchema);
}

/** Квота подписки и условия вывода RWUSD / BFUSD. */
export function fetchStableYieldQuota(
  creds: BinanceCredentials,
  product: keyof typeof STABLE_YIELD_PATHS,
): Promise<StableYieldQuota> {
  return get(creds, STABLE_YIELD_PATHS[product].quota, stableYieldQuotaSchema);
}

/**
 * Последняя опубликованная годовая ставка (`rateHistory`, size=1). Вес у этих ручек выше обычного —
 * вызывать только на холодный кэш каталога.
 */
export async function fetchLatestRate(
  creds: BinanceCredentials,
  product: keyof typeof STAKING_PATHS | keyof typeof STABLE_YIELD_PATHS,
): Promise<RatePoint | null> {
  const path =
    product === "eth" || product === "sol"
      ? STAKING_PATHS[product].rate
      : STABLE_YIELD_PATHS[product].rate;
  const { rows } = await get(creds, path, rateHistorySchema, { size: 1 });
  return rows[0] ?? null;
}
