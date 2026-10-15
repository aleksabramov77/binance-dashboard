import { z } from "zod";

// Ссылки на защитные ордера одной сделки на Binance Demo (spec 0012, PR 2b): по ним закрытие снимает
// только свои ордера и понимает, сработал ли свой стоп/тейк. Клиент-безопасно (только Zod).
// Та же форма — mirrorProtectRefsSchema в entities/experiment (слайс без @/…); совместимость типов
// проверяет компилятор в src/app/server/demoMirror.ts.

/** Algo-ордер фьючерсов (STOP_MARKET / TAKE_PROFIT_MARKET). */
const algoRefSchema = z.object({
  algoId: z.number(),
  clientAlgoId: z.string().nullable(),
});

/** Ордер спота: orderId может быть неизвестен (перечитали заявку частично), clientOrderId — наш. */
const spotOrderRefSchema = z.object({
  orderId: z.number().nullable(),
  clientOrderId: z.string(),
});

export const demoProtectRefsSchema = z.discriminatedUnion("market", [
  z.object({
    market: z.literal("futures"),
    /** Рыночный ордер входа. */
    entryOrderId: z.number().nullable(),
    stop: algoRefSchema.nullable(),
    takeProfit: algoRefSchema.nullable(),
  }),
  z.object({
    market: z.literal("spot"),
    /** Список OTO/OTOCO или OCO, в котором стоят стоп и тейк. */
    orderListId: z.number().nullable(),
    stop: spotOrderRefSchema.nullable(),
    takeProfit: spotOrderRefSchema.nullable(),
  }),
]);
export type DemoProtectRefs = z.infer<typeof demoProtectRefsSchema>;
