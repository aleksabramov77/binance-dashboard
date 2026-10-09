import { z } from "zod";

const decimal = z.coerce.number();

const filterSchema = z
  .object({
    filterType: z.string(),
    tickSize: z.string().optional(),
    stepSize: z.string().optional(),
    minQty: z.string().optional(),
    minNotional: z.string().optional(),
    notional: z.string().optional(),
  })
  .loose();

export const exchangeInfoSchema = z.object({
  symbols: z.array(
    z
      .object({
        symbol: z.string(),
        status: z.string(),
        filters: z.array(filterSchema),
      })
      .loose(),
  ),
});

export const priceSchema = z.object({ symbol: z.string(), price: decimal });

export const spotOrderSchema = z
  .object({
    symbol: z.string(),
    orderId: z.number(),
    executedQty: decimal,
    cummulativeQuoteQty: decimal,
    status: z.string(),
    fills: z
      .array(
        z.object({
          price: decimal,
          qty: decimal,
          commission: decimal,
          commissionAsset: z.string(),
        }),
      )
      .default([]),
  })
  .loose();

export const orderListSchema = z
  .object({ orderListId: z.number(), listStatusType: z.string() })
  .loose();

export const futuresOrderSchema = z
  .object({
    symbol: z.string(),
    orderId: z.number(),
    status: z.string(),
    executedQty: decimal,
    avgPrice: decimal,
  })
  .loose();

export const algoOrderSchema = z
  .object({ algoId: z.number(), algoStatus: z.string().optional() })
  .loose();

export const anySchema = z.unknown();

export const spotAccountBalancesSchema = z
  .object({
    balances: z.array(
      z.object({ asset: z.string(), free: decimal, locked: decimal }),
    ),
  })
  .loose();

export const futuresBalancesSchema = z.array(
  z
    .object({
      asset: z.string(),
      balance: decimal,
      availableBalance: decimal,
    })
    .loose(),
);

export type SpotOrder = z.infer<typeof spotOrderSchema>;
export type FuturesOrder = z.infer<typeof futuresOrderSchema>;
