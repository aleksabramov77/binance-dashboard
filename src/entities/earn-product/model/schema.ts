import { z } from "zod";

/** Виды продуктов Binance Earn, которые объясняет гид (spec 0019). */
export const EARN_KINDS = [
  "simple-flexible",
  "simple-locked",
  "soft-staking",
  "eth-staking",
  "sol-staking",
  "rwusd",
  "bfusd",
  "dual",
  "onchain",
  "smart-arbitrage",
  "auto-invest",
  "launchpool",
] as const;
export type EarnKind = (typeof EARN_KINDS)[number];

/** Виды с «доходным» каталогом по ключу — таблица вкладки «Стейкинг и DeFi». */
export const YIELD_KINDS = [
  "onchain",
  "eth-staking",
  "sol-staking",
  "rwusd",
  "bfusd",
  "soft-staking",
] as const;
export type YieldKind = (typeof YIELD_KINDS)[number];

/** Buy Low — вкладываешь стейбл и ждёшь цену ниже (PUT); Sell High — вкладываешь монету (CALL). */
export const DUAL_SIDES = ["buy-low", "sell-high"] as const;
export type DualSide = (typeof DUAL_SIDES)[number];

export const dualOfferSchema = z.object({
  id: z.string(),
  side: z.enum(DUAL_SIDES),
  /** Монета, на цену которой ставка (BTC). */
  coin: z.string(),
  /** Стейблкоин пары (USDT, USDC). */
  stable: z.string(),
  /** Целевая цена в стейбле. */
  strikePrice: z.number(),
  /** Годовая ставка, доля (0.25 = 25 %). */
  apr: z.number(),
  durationDays: z.number(),
  settleAt: z.string(),
  purchaseEndAt: z.string(),
  /** Лимиты покупки в единицах вкладываемого актива (монета у Sell High, стейбл у Buy Low). */
  minAmount: z.number(),
  maxAmount: z.number(),
  canPurchase: z.boolean(),
  /** Текущая цена монеты в стейбле; null — цену не нашли. */
  price: z.number().nullable(),
});

export const yieldProductSchema = z.object({
  id: z.string(),
  kind: z.enum(YIELD_KINDS),
  name: z.string(),
  /** Что вкладываешь. */
  asset: z.string(),
  /** В чём награда, если не в том же активе. */
  rewardAsset: z.string().nullable(),
  apr: z.number().nullable(),
  /** Срок блокировки в днях; null — гибкий продукт. */
  lockDays: z.number().nullable(),
  /** Сколько дней ждать возврата при выходе; 0 — сразу, null — не знаем. */
  redemptionDays: z.number().nullable(),
  minPurchase: z.number().nullable(),
  /** Остаток личной квоты в единицах актива. */
  quotaLeft: z.number().nullable(),
  soldOut: z.boolean(),
  priceUsd: z.number().nullable(),
});

/** Диапазон ставок вида продукта по активу — из публичной сводки (без ключа). */
export const kindSummarySchema = z.object({
  kind: z.enum(EARN_KINDS),
  asset: z.string(),
  minApr: z.number(),
  maxApr: z.number(),
  lowRisk: z.boolean(),
  soldOut: z.boolean(),
});

export const earnSummarySchema = z.object({
  fetchedAt: z.string(),
  items: z.array(kindSummarySchema),
});

export const advancedCatalogSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("not-configured"),
    /** cloud — облако: ключа аккаунта там нет намеренно, каталог только локально. */
    hosting: z.enum(["local", "cloud"]),
  }),
  z.object({ status: z.literal("error"), message: z.string() }),
  z.object({
    status: z.literal("ok"),
    fetchedAt: z.string(),
    dual: z.array(dualOfferSchema),
    yields: z.array(yieldProductSchema),
    /** Группы, которые не загрузились (остальные показываются). */
    warnings: z.array(z.string()),
  }),
]);

export type DualOffer = z.infer<typeof dualOfferSchema>;
export type YieldProduct = z.infer<typeof yieldProductSchema>;
export type KindSummary = z.infer<typeof kindSummarySchema>;
export type EarnSummary = z.infer<typeof earnSummarySchema>;
export type AdvancedCatalog = z.infer<typeof advancedCatalogSchema>;
