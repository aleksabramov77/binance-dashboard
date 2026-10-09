import { createHmac } from "node:crypto";
import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { binanceErrorSchema } from "./accountSchemas";

export class BinanceApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export type SignedParams = Record<string, string | number | boolean>;

/** Подписанный запрос (HMAC SHA256) к указанному хосту Binance. Секрет не покидает сервер. */
export async function signedRequest<T extends z.ZodType>(
  baseUrl: string,
  creds: BinanceCredentials,
  method: "GET" | "POST" | "DELETE",
  path: string,
  schema: T,
  params: SignedParams = {},
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

  const res = await fetch(`${baseUrl}${path}?${query}`, {
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
