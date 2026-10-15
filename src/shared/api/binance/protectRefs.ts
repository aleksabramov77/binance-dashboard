import { z } from "zod";
import { withLegacyMarketField } from "./markets.ts";

// Ссылки на защитные ордера одной сделки на Binance Demo (spec 0012, PR 2b): по ним закрытие снимает
// только свои ордера и понимает, сработал ли свой стоп/тейк. Клиент-безопасно (только Zod).
// Та же форма — mirrorProtectRefsSchema в entities/experiment (слайс без @/…); совместимость типов
// проверяет компилятор в src/app/server/demoMirror.ts.

/** Algo-ордер фьючерсов (STOP_MARKET / TAKE_PROFIT_MARKET). */
const algoRefSchema = z.object({
  /** null — исход постановки неизвестен и ордер не нашёлся: ищем и снимаем по clientAlgoId. */
  algoId: z.number().nullable(),
  clientAlgoId: z.string().nullable(),
});

/** Ордер спота: orderId может быть неизвестен (перечитали заявку частично), clientOrderId — наш. */
const spotOrderRefSchema = z.object({
  orderId: z.number().nullable(),
  clientOrderId: z.string(),
});

/** Старые строки с market "futures" (до spec 0023) читаются как usdm. */
export const demoProtectRefsSchema = z.preprocess(
  withLegacyMarketField,
  z.discriminatedUnion("market", [
    z.object({
      market: z.literal("usdm"),
      /** Рыночный ордер входа. */
      entryOrderId: z.number().nullable(),
      /**
       * Ноги на свой объём (quantity + reduceOnly/positionSide, с PR 2c). Нет — ноги с closePosition
       * (2b): сработавшая закроет всю сторону вместе с другими зеркалами.
       */
      legs: z.literal("quantity").optional(),
      stop: algoRefSchema.nullable(),
      takeProfit: algoRefSchema.nullable(),
    }),
    z.object({
      market: z.literal("spot"),
      /** Список OTO/OTOCO или OCO, в котором стоят стоп и тейк. */
      orderListId: z.number().nullable(),
      /**
       * Сколько монет пришло на баланс: куплено минус комиссия в покупаемой монете. Закрытие продаёт
       * не больше — иначе заберёт чужие монеты. Нет — по ставке комиссии от купленного.
       */
      netQuantity: z.number().nullable().optional(),
      stop: spotOrderRefSchema.nullable(),
      takeProfit: spotOrderRefSchema.nullable(),
    }),
  ]),
);
export type DemoProtectRefs = z.infer<typeof demoProtectRefsSchema>;
