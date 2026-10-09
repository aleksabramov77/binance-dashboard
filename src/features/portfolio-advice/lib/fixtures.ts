import type { Offer } from "@/entities/earn-offer";
import type { Holding } from "@/entities/holding";

export const offer = (
  patch: Partial<Offer> & Pick<Offer, "id" | "asset">,
): Offer => ({
  type: "flexible",
  durationDays: 0,
  maxApr: patch.baseApr ?? 0.03,
  baseApr: 0.03,
  tiers: [],
  minPurchase: null,
  maxPerUser: null,
  soldOut: false,
  stablecoin: ["USDT", "USDC", "U"].includes(patch.asset),
  priceUsd: 1,
  ...patch,
});

export const holding = (
  patch: Partial<Holding> & Pick<Holding, "asset" | "place" | "amount">,
): Holding => ({
  frozen: 0,
  priceUsd: 1,
  apr: 0,
  productId: null,
  durationDays: null,
  until: null,
  ...patch,
});
