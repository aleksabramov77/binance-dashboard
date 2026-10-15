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

/** Одна строка публичной сводки Earn по виду продукта (APR — доли: 0.0361 = 3,61 %). */
export const earnOverviewProductSchema = z.object({
  productType: z.string(),
  maxApr: nullableDecimal,
  minApr: nullableDecimal,
  /** "FLEXIBLE" и/или "FIXED". */
  duration: z.array(z.string()).nullable().catch(null),
  lowRisk: z.boolean().nullable().catch(null),
  soldOut: z.boolean().nullable().catch(null),
});

export const earnOverviewAssetSchema = z.object({
  asset: z.string(),
  productSummary: z.array(earnOverviewProductSchema).nullable().catch(null),
});

/** Сводка главной страницы Earn (`homepage/overview`, без ключа): ~12 топ-активов. */
export const earnOverviewResponseSchema = z.object({
  code: z.string(),
  data: z.object({ list: z.array(earnOverviewAssetSchema) }),
});

export type EarnOverviewAsset = z.infer<typeof earnOverviewAssetSchema>;
export type EarnOverviewProduct = z.infer<typeof earnOverviewProductSchema>;
