import { z } from "zod";

// Рынки Binance (spec 0023). Имена — как у групп активов в глоссарии: spot — Spot (api), usdm —
// USDⓈ-M Futures (fapi), coinm — COIN-M Futures (dapi). Среда-независимый модуль: его грузит и Deno.

export const BINANCE_MARKETS = ["spot", "usdm", "coinm"] as const;
export type BinanceMarket = (typeof BINANCE_MARKETS)[number];

/** Фьючерсные рынки: бессрочные контракты и funding. */
export type FuturesMarket = Exclude<BinanceMarket, "spot">;

/** Рынки ручных сделок и Binance Demo Trading (COIN-M на демо — позже). */
export const TRADE_MARKETS = ["spot", "usdm"] as const;
export type Market = (typeof TRADE_MARKETS)[number];

/** Имя USDⓈ-M до spec 0023: сетапы и сделки от старого клиента читаются как usdm. */
const legacy = (value: unknown) => (value === "futures" ? "usdm" : value);

export const tradeMarketSchema = z.preprocess(legacy, z.enum(TRADE_MARKETS));

/** Объект с полем market: старое имя рынка → новое (для discriminatedUnion по market). */
export const withLegacyMarketField = (value: unknown): unknown =>
  value !== null &&
  typeof value === "object" &&
  "market" in value &&
  value.market === "futures"
    ? { ...value, market: "usdm" }
    : value;
