import { createHmac } from "node:crypto";
import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import {
  describeNetworkError,
  HttpError,
  NetworkError,
  withRetry,
} from "@/shared/lib/fetchRetry";
import { binanceErrorSchema } from "./accountSchemas";

/** Binance ответил ошибкой (не сетевой сбой) — повторять бессмысленно. */
export class BinanceApiError extends HttpError {
  constructor(
    message: string,
    readonly code?: number,
    status = 400,
  ) {
    super(message, status);
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
  const attempt = async () => {
    // Подпись и timestamp — заново на каждую попытку.
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
            res.status,
          )
        : new BinanceApiError(
            `Binance ответил ${res.status} на ${path}`,
            undefined,
            res.status,
          );
    }
    return schema.parse(body) as z.infer<T>;
  };

  // Чтение повторяем при сбоях сети; ордера — нет, чтобы не открыть позицию дважды.
  if (method === "GET") return withRetry(`Binance ${path}`, attempt);
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof BinanceApiError) throw error;
    throw new NetworkError(
      `Binance ${path}: сеть оборвалась — ${describeNetworkError(error)}. Проверьте ордера на бирже.`,
    );
  }
}
