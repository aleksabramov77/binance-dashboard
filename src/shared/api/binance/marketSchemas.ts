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

export const futuresExchangeInfoSchema = z.object({
  symbols: z.array(
    z.object({
      symbol: z.string(),
      baseAsset: z.string(),
      quoteAsset: z.string(),
      contractType: z.string(),
      status: z.string(),
      /** COIN — монета; INDEX и прочее — индексы, акции, сырьё. */
      underlyingType: z.string().nullish(),
      /** Секторы: ["Layer-1", "Crypto"], у токенов реальных активов — "RWA". */
      underlyingSubType: z.array(z.string()).nullish(),
    }),
  ),
});

export type Ticker24h = z.infer<typeof ticker24hSchema>[number];

/** /fapi/v1/premiumIndex без symbol: mark price и текущая ставка funding по всем фьючерсам. */
export const premiumIndexSchema = z.array(
  z.object({
    symbol: z.string(),
    markPrice: decimal,
    // У поставочных контрактов ставки нет — пустая строка.
    lastFundingRate: z.union([z.literal(""), decimal]).catch(""),
  }),
);
