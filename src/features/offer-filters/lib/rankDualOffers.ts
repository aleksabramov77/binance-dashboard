import { evaluateOffer, type Offer } from "@/entities/earn-offer";
import {
  type DualEvaluation,
  type DualOffer,
  distanceToStrike,
  dualInvestAsset,
  evaluateDual,
} from "@/entities/earn-product";
import type { DualFilters } from "../model/useDualFilters";

export interface RankedDual {
  offer: DualOffer;
  evaluation: DualEvaluation | null;
  /** Расстояние от цены до страйка, доля со знаком. */
  distance: number | null;
  /** Лучший Simple Earn Flexible того же актива, что вкладываешь (ставка на сумму). */
  flexibleApr: number | null;
  /** APR Dual минус Flexible, доля (0.05 = +5 п.п.). */
  edge: number | null;
}

/** Лучшая ставка Flexible на сумму по каждому активу. */
function bestFlexibleApr(offers: Offer[], amountUsd: number) {
  const best = new Map<string, number>();
  for (const offer of offers) {
    if (offer.type !== "flexible" || offer.soldOut) continue;
    const apr = evaluateOffer(offer, amountUsd)?.effectiveApr ?? offer.baseApr;
    if (apr > (best.get(offer.asset) ?? -1)) best.set(offer.asset, apr);
  }
  return best;
}

/**
 * Фильтры Dual и сравнение с Flexible. Порядок — по превышению над Flexible: столько вы получаете
 * «сверху» за риск остаться не в той валюте; предложения без Flexible того же актива — в конце.
 */
export function rankDualOffers(
  offers: DualOffer[],
  simpleOffers: Offer[],
  filters: DualFilters,
): RankedDual[] {
  const flexible = bestFlexibleApr(simpleOffers, filters.amount);
  const coin = filters.dcoin.trim().toUpperCase();
  const minDistance = filters.minDist / 100;
  return (
    offers
      .filter((o) => o.canPurchase)
      .filter((o) => (coin ? o.coin === coin : true))
      .filter((o) => (filters.side === "all" ? true : o.side === filters.side))
      .filter((o) =>
        filters.maxDays > 0 ? o.durationDays <= filters.maxDays : true,
      )
      .map((offer): RankedDual => {
        const distance = distanceToStrike(offer.strikePrice, offer.price);
        const flexibleApr = flexible.get(dualInvestAsset(offer)) ?? null;
        return {
          offer,
          evaluation: evaluateDual(offer, filters.amount),
          distance,
          flexibleApr,
          edge: flexibleApr === null ? null : offer.apr - flexibleApr,
        };
      })
      .filter((r) =>
        minDistance > 0
          ? r.distance !== null && Math.abs(r.distance) >= minDistance
          : true,
      )
      // Без сравнения с Flexible — в конце (между собой — по APR): превышение и сырой APR не смешиваем.
      .sort((a, b) =>
        a.edge === null || b.edge === null
          ? Number(a.edge === null) - Number(b.edge === null) ||
            b.offer.apr - a.offer.apr
          : b.edge - a.edge,
      )
  );
}
