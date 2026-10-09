import type { Offer } from "../model/schema";

export interface OfferYield {
  /** Сумма в единицах актива, соответствующая введённой сумме в USD. */
  assetAmount: number;
  /** Средневзвешенная ставка для этой суммы с учётом ступеней и лимита. */
  effectiveApr: number;
  yearlyIncomeUsd: number;
  /** Сколько USD попадает под бонусные ступени (null — бонусов нет). */
  bonusCapUsd: number | null;
  belowMinimum: boolean;
}

function overlap(amount: number, from: number, to: number): number {
  return Math.max(0, Math.min(amount, to) - from);
}

/** Годовой доход в единицах актива на сумму `assetAmount`. */
export function yearlyIncome(offer: Offer, assetAmount: number): number {
  const earning = offer.maxPerUser
    ? Math.min(assetAmount, offer.maxPerUser)
    : assetAmount;
  const bonus = offer.tiers.reduce(
    (sum, t) => sum + t.bonusApr * overlap(earning, t.from, t.to),
    0,
  );
  return earning * offer.baseApr + bonus;
}

export function evaluateOffer(
  offer: Offer,
  amountUsd: number,
): OfferYield | null {
  if (!offer.priceUsd || amountUsd <= 0) return null;
  const assetAmount = amountUsd / offer.priceUsd;
  const income = yearlyIncome(offer, assetAmount);
  const bonusCap =
    offer.tiers.length > 0 ? Math.max(...offer.tiers.map((t) => t.to)) : null;
  return {
    assetAmount,
    effectiveApr: income / assetAmount,
    yearlyIncomeUsd: income * offer.priceUsd,
    bonusCapUsd: bonusCap === null ? null : bonusCap * offer.priceUsd,
    belowMinimum: offer.minPurchase !== null && assetAmount < offer.minPurchase,
  };
}
