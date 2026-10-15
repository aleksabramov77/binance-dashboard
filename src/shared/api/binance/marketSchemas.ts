import { z } from "zod";

const decimal = z.coerce.number();

export const ticker24hSchema = z.array(
  z.object({
    symbol: z.string(),
    lastPrice: decimal,
    priceChangePercent: decimal,
    highPrice: decimal,
    lowPrice: decimal,
    quoteVolume: decimal,
  }),
);

/** Свеча: [openTime, open, high, low, close, volume, closeTime, ...]. */
export const klinesSchema = z.array(
  z
    .tuple([
      z.number(),
      decimal,
      decimal,
      decimal,
      decimal,
      decimal,
      z.number(),
    ])
    .rest(z.unknown()),
);

/** exchangeInfo фьючерсов: fapi (USDⓈ-M) и dapi (COIN-M, статус — contractStatus). */
export const futuresExchangeInfoSchema = z.object({
  symbols: z.array(
    z.object({
      symbol: z.string(),
      baseAsset: z.string(),
      quoteAsset: z.string(),
      contractType: z.string(),
      status: z.string().optional(),
      contractStatus: z.string().optional(),
      /** COIN-M: размер контракта в USD (BTC — 100, остальные — 10). */
      contractSize: z.number().optional(),
    }),
  ),
});

export type Ticker24h = z.infer<typeof ticker24hSchema>[number];

/** /dapi/v1/ticker/24hr: оборот — volume в контрактах (и baseVolume в монете), quoteVolume нет. */
export const coinmTicker24hSchema = z.array(
  z.object({
    symbol: z.string(),
    lastPrice: decimal,
    priceChangePercent: decimal,
    highPrice: decimal,
    lowPrice: decimal,
    volume: decimal,
  }),
);

export type CoinmTicker24h = z.infer<typeof coinmTicker24hSchema>[number];

/** /fapi/v1/premiumIndex и /dapi/v1/premiumIndex без symbol: mark price и текущая ставка funding по всем фьючерсам. */
export const premiumIndexSchema = z.array(
  z.object({
    symbol: z.string(),
    markPrice: decimal,
    // У поставочных контрактов ставки нет — пустая строка.
    lastFundingRate: z.union([z.literal(""), decimal]).catch(""),
  }),
);
