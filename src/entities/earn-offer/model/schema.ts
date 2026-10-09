import { z } from "zod";

export const offerTierSchema = z.object({
  /** Границы ступени в единицах актива. */
  from: z.number(),
  to: z.number(),
  /** Бонусная ставка поверх базовой на этой ступени (0.02 = 2%). */
  bonusApr: z.number(),
});

export const offerSchema = z.object({
  id: z.string(),
  asset: z.string(),
  type: z.enum(["flexible", "locked"]),
  durationDays: z.number(),
  /** Ставка, которую Binance показывает как максимальную. */
  maxApr: z.number(),
  /** Ставка без бонусных ступеней — действует на любую сумму. */
  baseApr: z.number(),
  tiers: z.array(offerTierSchema),
  minPurchase: z.number().nullable(),
  maxPerUser: z.number().nullable(),
  soldOut: z.boolean(),
  stablecoin: z.boolean(),
  priceUsd: z.number().nullable(),
});

export const snapshotSchema = z.object({
  fetchedAt: z.string(),
  offers: z.array(offerSchema),
});

export const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added"), at: z.string(), offer: offerSchema }),
  z.object({ kind: z.literal("removed"), at: z.string(), offer: offerSchema }),
  z.object({
    kind: z.literal("apr"),
    at: z.string(),
    offer: offerSchema,
    before: z.number(),
    after: z.number(),
  }),
  z.object({
    kind: z.literal("tiers"),
    at: z.string(),
    offer: offerSchema,
    before: z.array(offerTierSchema),
  }),
  z.object({ kind: z.literal("soldOut"), at: z.string(), offer: offerSchema }),
  z.object({ kind: z.literal("reopened"), at: z.string(), offer: offerSchema }),
]);

export const earnOverviewSchema = z.object({
  latest: snapshotSchema.nullable(),
  changes: z.array(changeSchema),
  snapshotCount: z.number(),
});

export type OfferTier = z.infer<typeof offerTierSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type OfferChange = z.infer<typeof changeSchema>;
export type EarnOverview = z.infer<typeof earnOverviewSchema>;
