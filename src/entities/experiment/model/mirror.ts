import { normalizeMarket } from "@binance-dashboard/trading-core";
import { z } from "zod";

// Demo-зеркало (spec 008): статусы зеркальной сделки на Binance Demo.

export const MIRROR_STATUSES = [
  "pending",
  "protected",
  "unprotected",
  "rejected",
  "skipped",
  "closing",
  "closed",
  "close_failed",
] as const;
export const mirrorStatusSchema = z.enum(MIRROR_STATUSES);
export type MirrorStatus = z.infer<typeof mirrorStatusSchema>;

/**
 * Позиция на демо открыта — её надо закрыть вместе с paper-сделкой. close_failed — повторяем
 * попытку на следующем прогоне, пока не закроется.
 */
export const OPEN_MIRROR_STATUSES = [
  "protected",
  "unprotected",
  "close_failed",
] as const satisfies readonly MirrorStatus[];

/** Символ занят зеркалом: второй вход по нему не делаем (на фьючерсах TP/SL общие на символ). */
export const ACTIVE_MIRROR_STATUSES = [
  "pending",
  "protected",
  "unprotected",
  "closing",
  "close_failed",
] as const satisfies readonly MirrorStatus[];

export const MIRROR_STATUS_LABELS: Record<MirrorStatus, string> = {
  pending: "отправляется",
  protected: "открыта, TP/SL",
  unprotected: "открыта без защиты",
  rejected: "не открылась",
  skipped: "пропущена",
  closing: "закрывается",
  closed: "закрыта",
  close_failed: "не закрылась",
};

export const experimentDemoMirrorSchema = z.object({
  id: z.string().min(1),
  demoMirror: z.boolean(),
});
export type ExperimentDemoMirror = z.infer<typeof experimentDemoMirrorSchema>;

/**
 * Свои защитные ордера зеркала на Binance Demo (spec 0012, PR 2b): закрытие снимает только их и
 * по их статусу понимает, сработал ли стоп/тейк. Та же форма, что demoProtectRefsSchema в
 * shared/api/binance (этот слайс — без @/…, его читает Deno); совместимость проверяет компилятор
 * в src/app/server/demoMirror.ts. null — старые строки и входы без защиты: закрытие по-старому.
 */
const algoRefSchema = z.object({
  /** null — исход постановки неизвестен и ордер не нашёлся: ищем и снимаем по clientAlgoId. */
  algoId: z.number().nullable(),
  clientAlgoId: z.string().nullable(),
});
const spotOrderRefSchema = z.object({
  orderId: z.number().nullable(),
  clientOrderId: z.string(),
});
/** Старый market "futures" (строки до spec 0023, если миграция их не застала) читается как usdm. */
const legacyRefs = (value: unknown): unknown =>
  value !== null &&
  typeof value === "object" &&
  "market" in value &&
  value.market !== normalizeMarket(value.market)
    ? { ...value, market: normalizeMarket(value.market) }
    : value;

export const mirrorProtectRefsSchema = z.preprocess(
  legacyRefs,
  z.discriminatedUnion("market", [
    z.object({
      market: z.literal("usdm"),
      entryOrderId: z.number().nullable(),
      stop: algoRefSchema.nullable(),
      takeProfit: algoRefSchema.nullable(),
    }),
    z.object({
      market: z.literal("spot"),
      orderListId: z.number().nullable(),
      netQuantity: z.number().nullable().optional(),
      stop: spotOrderRefSchema.nullable(),
      takeProfit: spotOrderRefSchema.nullable(),
    }),
  ]),
);
export type MirrorProtectRefs = z.infer<typeof mirrorProtectRefsSchema>;

export const mirrorViewSchema = z.object({
  status: mirrorStatusSchema,
  message: z.string(),
});
export type MirrorView = z.infer<typeof mirrorViewSchema>;
