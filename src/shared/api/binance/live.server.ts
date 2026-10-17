// Клиент реального счёта (Live, spec 0047, 0049): торговый ключ субсчёта BINANCE_TRADE_*. Только сервер воркера
// (scripts/live-worker.ts): у веб-приложения этого ключа нет. Каждый запрос сверяется с белым списком
// liveAllowlist.ts до подписи и сети: чтение счёта и ордера Spot / USDⓈ-M, без переводов, выводов и займов.
import { z } from "zod";
import type { LiveCredentials } from "@/shared/config/env.server";
import {
  assertLiveAllowed,
  LIVE_HOSTS,
  type LiveMarket,
  LiveRequestDeniedError,
  type LiveRoute,
} from "./liveAllowlist";
import {
  type LiveFuturesAccount,
  type LiveSpotAccount,
  liveFuturesAccountSchema,
  liveSpotAccountSchema,
} from "./liveRestrictions";
import { type SignedParams, signedRequest } from "./signed";
import type { TradeVenue } from "./venue.server";

export type LiveHosts = Readonly<Record<LiveMarket, string>>;

/**
 * Демо-хосты для режима воркера «площадка демо» (spec 0049): тот же код и белый список реального счёта, но
 * Binance Demo и демо-ключ — только для локальной проверки (воркер запрещает режим в production и не на localhost).
 */
export const LIVE_DEMO_HOSTS: LiveHosts = {
  spot: "demo-api.binance.com",
  usdm: "demo-fapi.binance.com",
};

/** Ключ и хосты клиента реального счёта. По умолчанию — настоящие хосты Binance. */
export interface LiveClient {
  readonly creds: LiveCredentials;
  readonly hosts: LiveHosts;
}

export const liveClient = (
  creds: LiveCredentials,
  hosts: LiveHosts = LIVE_HOSTS,
): LiveClient => ({ creds, hosts });

/**
 * Единственный путь подписанных запросов с ключом реального счёта: белый список → signedRequest.
 * Запрос вне списка бросает LiveRequestDeniedError, ничего не отправив.
 */
export function liveSignedRequest<T extends z.ZodType>(
  client: LiveClient,
  route: LiveRoute,
  schema: T,
  params: SignedParams = {},
): Promise<z.infer<T>> {
  assertLiveAllowed(route);
  return signedRequest(
    `https://${client.hosts[route.market]}`,
    client.creds.live,
    route.method,
    route.path,
    schema,
    params,
  );
}

/**
 * Площадка реального счёта для логики ордеров (features/execute-trade): каждый подписанный запрос — через
 * liveSignedRequest и белый список; публичные справочники — те же хосты без ключа.
 */
export function liveVenue(client: LiveClient): TradeVenue {
  return {
    kind: "live",
    publicUrl: {
      spot: `https://${client.hosts.spot}`,
      usdm: `https://${client.hosts.usdm}`,
    },
    signed: (market, method, path, schema, params = {}) => {
      // COIN-M на реальном счёте не торгуется (spec 0056, AC9): отказ до подписи и сети, как вне белого списка.
      if (market === "coinm")
        throw new LiveRequestDeniedError(
          `Live: COIN-M на реальном счёте не торгуется (${method} ${path})`,
        );
      return liveSignedRequest(
        client,
        { method, market, path },
        schema,
        params,
      );
    },
  };
}

/**
 * Права ключа (`GET /sapi/v1/account/apiRestrictions`, вес 1). Ответ — как есть: разбор и оценка — в
 * evaluateRestrictions, чтобы неизвестный ответ дал блокировку с причиной, а не ошибку формата.
 */
export function fetchLiveApiRestrictions(client: LiveClient): Promise<unknown> {
  return liveSignedRequest(
    client,
    {
      method: "GET",
      market: "spot",
      path: "/sapi/v1/account/apiRestrictions",
    },
    z.unknown(),
  );
}

/** Аккаунт Spot субсчёта (`GET /api/v3/account`, вес 20): UID и ненулевые остатки. */
export function fetchLiveSpotAccount(
  client: LiveClient,
): Promise<LiveSpotAccount> {
  return liveSignedRequest(
    client,
    { method: "GET", market: "spot", path: "/api/v3/account" },
    liveSpotAccountSchema,
    { omitZeroBalances: "true" },
  );
}

/** Аккаунт USDⓈ-M субсчёта (`GET /fapi/v3/account`, вес 5): итоги кошелька. */
export function fetchLiveFuturesAccount(
  client: LiveClient,
): Promise<LiveFuturesAccount> {
  return liveSignedRequest(
    client,
    { method: "GET", market: "usdm", path: "/fapi/v3/account" },
    liveFuturesAccountSchema,
  );
}
