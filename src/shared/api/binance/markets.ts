import {
  normalizeMarket,
  withLegacyMarketField,
} from "@binance-dashboard/trading-core";
import { z } from "zod";

// Рынки Binance (spec 0023). Имена — как у групп активов в глоссарии: spot — Spot (api), usdm —
// USDⓈ-M Futures (fapi), coinm — COIN-M Futures (dapi). Среда-независимый модуль: его грузит и Deno.
// Чтение старого имени futures — одна реализация в trading-core (normalizeMarket): имена рынков
// доменно-нейтральны, как индикаторы, которые shared/lib тоже берёт из ядра.

export const BINANCE_MARKETS = ["spot", "usdm", "coinm"] as const;
export type BinanceMarket = (typeof BINANCE_MARKETS)[number];

/** Фьючерсные рынки: бессрочные контракты и funding. */
export type FuturesMarket = Exclude<BinanceMarket, "spot">;

/** Рынки ручных сделок (/signals) и их истории на Binance Demo; COIN-M на демо торгует только зеркало (spec 0056). */
export const TRADE_MARKETS = ["spot", "usdm"] as const;
export type Market = (typeof TRADE_MARKETS)[number];

/** Рынок сделки; старое имя USDⓈ-M (futures) — сетапы и сделки от старого клиента — читается как usdm. */
export const tradeMarketSchema = z.preprocess(
  normalizeMarket,
  z.enum(TRADE_MARKETS),
);

/** Любой рынок Binance (заявка зеркала: Spot, USDⓈ-M, COIN-M); старое futures — usdm. */
export const binanceMarketSchema = z.preprocess(
  normalizeMarket,
  z.enum(BINANCE_MARKETS),
);

export { withLegacyMarketField };
