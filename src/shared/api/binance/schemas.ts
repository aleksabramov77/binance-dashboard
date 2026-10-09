import { z } from "zod";

/** Числа Binance приходят строками ("0.04868427") или null. */
const decimal = z.coerce.number();
const nullableDecimal = decimal.nullable().catch(null);

export const apyTierSchema = z.object({
  beginAmount: decimal,
  endAmount: decimal,
  ratio: decimal,
});

export const earnProductDetailSchema = z.object({
  productId: z.string(),
  productType: z.string(),
  duration: decimal,
  apy: decimal,
  marketApr: nullableDecimal,
  posBasicApy: nullableDecimal,
  posFixedExtraInterest: nullableDecimal,
  apyTierOption: z.array(apyTierSchema).nullable(),
  sellOut: z.boolean(),
  status: z.string(),
  minPurchaseAmount: nullableDecimal,
  maxPurchaseAmountPerUser: nullableDecimal,
});

export const earnProductSchema = z.object({
  productId: z.string(),
  asset: z.string(),
  productDetailList: z.array(earnProductDetailSchema),
});

export const earnProductsResponseSchema = z.object({
  code: z.string(),
  data: z.object({
    total: decimal,
    list: z.array(earnProductSchema),
  }),
});

export const tickerPricesSchema = z.array(
  z.object({ symbol: z.string(), price: decimal }),
);

export type EarnProduct = z.infer<typeof earnProductSchema>;
export type EarnProductDetail = z.infer<typeof earnProductDetailSchema>;
