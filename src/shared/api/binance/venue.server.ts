// Торговая площадка (spec 0049): куда уходят подписанные запросы ордеров и откуда берутся публичные справочники.
// Демо — Binance Demo Trading (signedRequest на демо-хосты, ключ BINANCE_DEMO_*). Реальный счёт — клиент Live с белым
// списком (live.server.ts → liveVenue). Логика ордеров (features/execute-trade) одна для обеих площадок.
import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { type SignedParams, signedRequest } from "./signed";

/** Рынки, на которых торгуют площадки: Spot и USDⓈ-M. */
export type VenueMarket = "spot" | "usdm";
export type VenueMethod = "GET" | "POST" | "DELETE";

export interface TradeVenue {
  /** demo — Binance Demo Trading; live — торговый субсчёт (или он же на демо-хостах для локальной проверки). */
  readonly kind: "demo" | "live";
  /** Публичные адреса рынков (exchangeInfo, ticker/price) — без ключа. */
  readonly publicUrl: Readonly<Record<VenueMarket, string>>;
  /** Подписанный запрос к рынку площадки. */
  signed<T extends z.ZodType>(
    market: VenueMarket,
    method: VenueMethod,
    path: string,
    schema: T,
    params?: SignedParams,
  ): Promise<z.infer<T>>;
}

/**
 * Binance Demo Trading — виртуальные деньги, реальные котировки. Хосты: spot, фьючерсы USDⓈ-M и COIN-M
 * (demo-dapi — пока только чтение баланса, spec 0038; демо-зеркала COIN-M нет).
 */
export const DEMO_URL = {
  spot: "https://demo-api.binance.com",
  futures: "https://demo-fapi.binance.com",
  coinm: "https://demo-dapi.binance.com",
} as const;

/** Публичные адреса демо-рынков. */
export const DEMO_PUBLIC: Readonly<Record<VenueMarket, string>> = {
  spot: DEMO_URL.spot,
  usdm: DEMO_URL.futures,
};

/** Площадка Binance Demo: signedRequest на демо-хосты с демо-ключом. */
export function demoVenue(creds: BinanceCredentials): TradeVenue {
  return {
    kind: "demo",
    publicUrl: DEMO_PUBLIC,
    signed: (market, method, path, schema, params = {}) =>
      signedRequest(DEMO_PUBLIC[market], creds, method, path, schema, params),
  };
}
