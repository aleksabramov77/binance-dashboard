import {
  evaluateOffer,
  type Offer,
  type OfferYield,
} from "@/entities/earn-offer";
import type { OfferFilters } from "../model/useOfferFilters";

export interface RankedOffer {
  offer: Offer;
  yield: OfferYield | null;
}

/** Фильтрует предложения и сортирует по реальной ставке для введённой суммы. */
export function rankOffers(
  offers: Offer[],
  filters: OfferFilters,
): RankedOffer[] {
  const query = filters.q.trim().toUpperCase();
  return offers
    .filter((o) => (filters.type === "all" ? true : o.type === filters.type))
    .filter((o) => (filters.stable ? o.stablecoin : true))
    .filter((o) => (filters.hideSoldOut ? !o.soldOut : true))
    .filter((o) => (query ? o.asset.includes(query) : true))
    .map((offer) => ({ offer, yield: evaluateOffer(offer, filters.amount) }))
    .sort(
      (a, b) =>
        (b.yield?.effectiveApr ?? b.offer.maxApr) -
        (a.yield?.effectiveApr ?? a.offer.maxApr),
    );
}
