import { createHmac } from "node:crypto";
import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import {
  describeNetworkError,
  HttpError,
  NetworkError,
  withRetry,
} from "@/shared/lib/fetchRetry";
import { log } from "@/shared/lib/logger.server";
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

/**
 * Биржа ответила 2xx, но ответ не совпал со схемой. Для ордеров это значит
 * «скорее всего исполнен» — нельзя считать его отклонённым.
 */
export class ResponseFormatError extends HttpError {}

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
    // recvWindow по умолчанию 10 с; ордера входа задают своё (ORDER_RECV_WINDOW_MS, orderOutcome.ts).
    const query = new URLSearchParams({
      recvWindow: "10000",
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ),
      timestamp: String(Date.now()),
    });
    query.set(
      "signature",
      createHmac("sha256", creds.apiSecret)
        .update(query.toString())
        .digest("hex"),
    );

    const started = Date.now();
    const res = await fetch(`${baseUrl}${path}?${query}`, {
      method,
      headers: { "X-MBX-APIKEY": creds.apiKey },
      cache: "no-store",
    });
    const body: unknown = await res.json();
    // Параметры запроса — без подписи и ключа (они не в params).
    const meta = {
      host: new URL(baseUrl).host,
      method,
      path,
      status: res.status,
      ms: Date.now() - started,
      params,
    };
    if (!res.ok) {
      const error = binanceErrorSchema.safeParse(body);
      log.warn("binance.error", `${method} ${path} → ${res.status}`, {
        ...meta,
        body,
      });
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
    if (method === "GET")
      log.debug("binance.request", `${method} ${path} → ${res.status}`, meta);
    else log.info("binance.write", `${method} ${path} → ${res.status}`, meta);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.error(
        "binance.schema",
        `${method} ${path}: неожиданный формат ответа`,
        {
          ...meta,
          issues: parsed.error.issues.slice(0, 5),
        },
      );
      // HttpError — не повторяем: биржа ответила успешно, повтор ордера опасен.
      throw new ResponseFormatError(
        `Binance ${path}: ответ ${res.status} не распознан — операция, вероятно, выполнена`,
        res.status,
        body,
      );
    }
    return parsed.data as z.infer<T>;
  };

  // Чтение повторяем при сбоях сети; ордера — нет, чтобы не открыть позицию дважды.
  if (method === "GET") return withRetry(`Binance ${path}`, attempt);
  try {
    return await attempt();
  } catch (error) {
    if (
      error instanceof BinanceApiError ||
      error instanceof ResponseFormatError
    )
      throw error;
    const failure = new NetworkError(
      `Binance ${path}: сеть оборвалась — ${describeNetworkError(error)}. Проверьте ордера на бирже.`,
    );
    // Ордер мог дойти до биржи — это важно видеть в журнале.
    log.error(
      "binance.order.network",
      failure.message,
      { method, path, params },
      error,
    );
    throw failure;
  }
}
