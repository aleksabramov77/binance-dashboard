// Клиент реального счёта (Live, spec 0047): торговый ключ субсчёта BINANCE_TRADE_*. Только сервер воркера
// (scripts/live-worker.ts): у веб-приложения этого ключа нет. Каждый запрос сверяется с белым списком
// liveAllowlist.ts до подписи и сети; в этой задаче список — только чтение.
import { z } from "zod";
import type { LiveCredentials } from "@/shared/config/env.server";
import { assertLiveAllowed, LIVE_HOSTS, type LiveRoute } from "./liveAllowlist";
import {
  type LiveFuturesAccount,
  type LiveSpotAccount,
  liveFuturesAccountSchema,
  liveSpotAccountSchema,
} from "./liveRestrictions";
import { type SignedParams, signedRequest } from "./signed";

/**
 * Единственный путь подписанных запросов с ключом реального счёта: белый список → signedRequest.
 * Запрос вне списка бросает LiveRequestDeniedError, ничего не отправив.
 */
export function liveSignedRequest<T extends z.ZodType>(
  creds: LiveCredentials,
  route: LiveRoute,
  schema: T,
  params: SignedParams = {},
): Promise<z.infer<T>> {
  assertLiveAllowed(route);
  return signedRequest(
    `https://${route.host}`,
    creds.live,
    route.method,
    route.path,
    schema,
    params,
  );
}

/**
 * Права ключа (`GET /sapi/v1/account/apiRestrictions`, вес 1). Ответ — как есть: разбор и оценка — в
 * evaluateRestrictions, чтобы неизвестный ответ дал блокировку с причиной, а не ошибку формата.
 */
export function fetchLiveApiRestrictions(
  creds: LiveCredentials,
): Promise<unknown> {
  return liveSignedRequest(
    creds,
    {
      method: "GET",
      host: LIVE_HOSTS.spot,
      path: "/sapi/v1/account/apiRestrictions",
    },
    z.unknown(),
  );
}

/** Аккаунт Spot субсчёта (`GET /api/v3/account`, вес 20): UID и ненулевые остатки. */
export function fetchLiveSpotAccount(
  creds: LiveCredentials,
): Promise<LiveSpotAccount> {
  return liveSignedRequest(
    creds,
    { method: "GET", host: LIVE_HOSTS.spot, path: "/api/v3/account" },
    liveSpotAccountSchema,
    { omitZeroBalances: "true" },
  );
}

/** Аккаунт USDⓈ-M субсчёта (`GET /fapi/v3/account`, вес 5): итоги кошелька. */
export function fetchLiveFuturesAccount(
  creds: LiveCredentials,
): Promise<LiveFuturesAccount> {
  return liveSignedRequest(
    creds,
    { method: "GET", host: LIVE_HOSTS.usdm, path: "/fapi/v3/account" },
    liveFuturesAccountSchema,
  );
}
