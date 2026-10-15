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
        // Только спот: разрешены ли составные заявки (OCO, OTO/OTOCO).
        ocoAllowed: z.boolean().optional(),
        otoAllowed: z.boolean().optional(),
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

/**
 * Ответ составной заявки OTO / OTOCO (newOrderRespType=FULL): по отчёту на каждый ордер —
 * рабочий (вход) первым, затем отложенные (стоп/тейк, PENDING_NEW до исполнения входа).
 */
export const orderListReportsSchema = z
  .object({
    orderListId: z.number(),
    listStatusType: z.string(),
    listOrderStatus: z.string(),
    orderReports: z.array(
      z
        .object({
          orderId: z.number(),
          type: z.string(),
          side: z.enum(["BUY", "SELL"]),
          status: z.string(),
          origQty: decimal,
          executedQty: decimal,
          cummulativeQuoteQty: decimal,
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
        .loose(),
    ),
  })
  .loose();

/** Один ордер спота (GET /api/v3/order) — статус отложенного ордера после входа. */
export const spotOrderStatusSchema = z
  .object({ orderId: z.number(), type: z.string(), status: z.string() })
  .loose();

/** GET /api/v3/order целиком: по нему перечитываем заявку с неизвестным исходом (без комиссии). */
export const spotOrderQuerySchema = z
  .object({
    orderId: z.number(),
    orderListId: z.number().catch(-1),
    type: z.string(),
    side: z.enum(["BUY", "SELL"]),
    status: z.string(),
    executedQty: decimal,
    cummulativeQuoteQty: decimal,
  })
  .loose();

export const futuresOrderSchema = z
  .object({
    symbol: z.string(),
    orderId: z.number(),
    status: z.string(),
    // Демо-фьючерсы иногда не присылают avgPrice/executedQty — это не ошибка ордера.
    executedQty: decimal.catch(0),
    avgPrice: decimal.catch(0),
  })
  .loose();

export const positionRiskSchema = z.array(
  z
    .object({
      symbol: z.string(),
      positionAmt: decimal,
      entryPrice: decimal,
      unRealizedProfit: decimal.catch(0),
    })
    .loose(),
);

/** История и активные algo-ордера (TP/SL) символа на демо-фьючерсах. */
export const algoHistorySchema = z.array(
  z
    .object({
      symbol: z.string(),
      orderType: z.string(),
      side: z.enum(["BUY", "SELL"]),
      algoStatus: z.string(),
      triggerPrice: decimal.catch(0),
      // id рыночного ордера, которым исполнился TP/SL; "" или нет поля — ещё не срабатывал.
      actualOrderId: z
        .union([z.string(), z.number()])
        .optional()
        .transform((v) => (v === undefined || v === "" ? null : Number(v)))
        .catch(null),
    })
    .loose(),
);

export const futuresAllOrdersSchema = z.array(
  z
    .object({
      orderId: z.number(),
      type: z.string(),
      side: z.enum(["BUY", "SELL"]),
      status: z.string(),
      clientOrderId: z.string(),
      stopPrice: decimal.catch(0),
    })
    .loose(),
);

export const spotAllOrdersSchema = z.array(
  z
    .object({
      orderId: z.number(),
      type: z.string(),
      side: z.enum(["BUY", "SELL"]),
      status: z.string(),
      stopPrice: decimal.catch(0),
    })
    .loose(),
);

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

/** Любой список, где у строк есть символ: OCO-история, ордера, income, позиции. */
export const symbolRowsSchema = z.array(
  z.object({ symbol: z.string() }).loose(),
);

export const spotMyTradesSchema = z.array(
  z
    .object({
      symbol: z.string(),
      orderId: z.number(),
      price: decimal,
      qty: decimal,
      quoteQty: decimal,
      commission: decimal,
      commissionAsset: z.string(),
      time: z.number(),
      isBuyer: z.boolean(),
    })
    .loose(),
);

export const futuresUserTradesSchema = z.array(
  z
    .object({
      symbol: z.string(),
      orderId: z.number(),
      side: z.enum(["BUY", "SELL"]),
      price: decimal,
      qty: decimal,
      quoteQty: decimal,
      realizedPnl: decimal,
      commission: decimal,
      commissionAsset: z.string(),
      time: z.number(),
    })
    .loose(),
);

export type SpotOrder = z.infer<typeof spotOrderSchema>;
export type OrderListReports = z.infer<typeof orderListReportsSchema>;
export type FuturesOrder = z.infer<typeof futuresOrderSchema>;
export type SpotOrderQuery = z.infer<typeof spotOrderQuerySchema>;
