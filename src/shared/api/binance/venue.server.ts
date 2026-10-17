// Торговая площадка (spec 0049): куда уходят подписанные запросы ордеров и откуда берутся публичные справочники.
// Демо — Binance Demo Trading (signedRequest на демо-хосты, ключ BINANCE_DEMO_*). Реальный счёт — клиент Live с белым
// списком (live.server.ts → liveVenue). Логика ордеров (features/execute-trade) одна для обеих площадок.
import type { z } from "zod";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { type SignedParams, signedRequest } from "./signed";

/**
 * Рынки, на которых торгуют площадки: Spot, USDⓈ-M и COIN-M (spec 0056). COIN-M — только у демо: у реального
 * счёта адреса COIN-M нет, его подписанный запрос к COIN-M отклоняется до сети (liveVenue).
 */
export type VenueMarket = "spot" | "usdm" | "coinm";
/** Фьючерсные рынки площадки: USDⓈ-M (fapi) и COIN-M (dapi). */
export type VenueFuturesMarket = Exclude<VenueMarket, "spot">;
export type VenueMethod = "GET" | "POST" | "DELETE";

/** Публичные адреса рынков площадки; coinm — только у демо (spec 0056). */
export type VenuePublicUrls = Readonly<
  Record<"spot" | "usdm", string> & { coinm?: string }
>;

export interface TradeVenue {
  /** demo — Binance Demo Trading; live — торговый субсчёт (или он же на демо-хостах для локальной проверки). */
  readonly kind: "demo" | "live";
  /** Публичные адреса рынков (exchangeInfo, ticker/price) — без ключа. */
  readonly publicUrl: VenuePublicUrls;
  /** Подписанный запрос к рынку площадки. */
  signed<T extends z.ZodType>(
    market: VenueMarket,
    method: VenueMethod,
    path: string,
    schema: T,
    params?: SignedParams,
  ): Promise<z.infer<T>>;
}

/** Публичный адрес рынка площадки; COIN-M у площадки без него (реальный счёт) — ошибка, запрос не уходит. */
export function venuePublicUrl(
  venue: { kind: TradeVenue["kind"]; publicUrl: VenuePublicUrls },
  market: VenueMarket,
): string {
  const url = venue.publicUrl[market];
  if (!url)
    throw new Error(
      `${market} на площадке «${venue.kind === "demo" ? "Binance Demo" : "реальный счёт"}» не торгуется`,
    );
  return url;
}

/**
 * Binance Demo Trading — виртуальные деньги, реальные котировки. Хосты: spot, фьючерсы USDⓈ-M и COIN-M
 * (demo-dapi: демо-зеркало COIN-M, spec 0056).
 */
export const DEMO_URL = {
  spot: "https://demo-api.binance.com",
  futures: "https://demo-fapi.binance.com",
  coinm: "https://demo-dapi.binance.com",
} as const;

/** Публичные адреса демо-рынков. */
export const DEMO_PUBLIC = {
  spot: DEMO_URL.spot,
  usdm: DEMO_URL.futures,
  coinm: DEMO_URL.coinm,
} as const satisfies Record<VenueMarket, string>;

/** Площадка Binance Demo: signedRequest на демо-хосты с демо-ключом. */
export function demoVenue(creds: BinanceCredentials): TradeVenue {
  return {
    kind: "demo",
    publicUrl: DEMO_PUBLIC,
    signed: (market, method, path, schema, params = {}) =>
      signedRequest(DEMO_PUBLIC[market], creds, method, path, schema, params),
  };
}
