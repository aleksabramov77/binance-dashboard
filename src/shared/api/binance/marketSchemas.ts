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
    }),
  ),
});

export type Ticker24h = z.infer<typeof ticker24hSchema>[number];
