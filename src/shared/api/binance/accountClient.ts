import { createHmac } from "node:crypto";
import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import {
  binanceErrorSchema,
  type FlexiblePosition,
  type FundingAsset,
  flexiblePositionsSchema,
  fundingAssetsSchema,
  type LockedPosition,
  lockedPositionsSchema,
  type SpotAccount,
  spotAccountSchema,
  type WalletBalance,
  walletBalancesSchema,
} from "./accountSchemas";

const API_URL = "https://api.binance.com";
const PAGE_SIZE = 100;

export class BinanceApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** Подписанный запрос (HMAC SHA256). Секрет не покидает сервер. */
async function signedRequest<T extends z.ZodType>(
  creds: BinanceCredentials,
  method: "GET" | "POST",
  path: string,
  schema: T,
  params: Record<string, string | number> = {},
): Promise<z.infer<T>> {
  const query = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
    recvWindow: "10000",
    timestamp: String(Date.now()),
  });
  query.set(
    "signature",
    createHmac("sha256", creds.apiSecret)
      .update(query.toString())
      .digest("hex"),
  );

  const res = await fetch(`${API_URL}${path}?${query}`, {
    method,
    headers: { "X-MBX-APIKEY": creds.apiKey },
    cache: "no-store",
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    const error = binanceErrorSchema.safeParse(body);
    throw error.success
      ? new BinanceApiError(
          `Binance: ${error.data.msg} (${error.data.code})`,
          error.data.code,
        )
      : new BinanceApiError(`Binance ответил ${res.status} на ${path}`);
  }
  return schema.parse(body);
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
