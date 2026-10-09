import type { Offer, OfferChange, OfferTier, Snapshot } from "./schema";

/** Флотирующие ставки Flexible меняются каждый день — мелкие колебания не считаем новостью. */
export const APR_CHANGE_THRESHOLD = 0.005;

const sameTiers = (a: OfferTier[], b: OfferTier[]) =>
  a.length === b.length &&
  a.every(
    (t, i) =>
      t.from === b[i].from && t.to === b[i].to && t.bonusApr === b[i].bonusApr,
  );

export function diffSnapshots(
  previous: Snapshot,
  next: Snapshot,
): OfferChange[] {
  const at = next.fetchedAt;
  const before = new Map(previous.offers.map((o) => [o.id, o]));
  const after = new Map(next.offers.map((o) => [o.id, o]));
  const changes: OfferChange[] = [];

  for (const offer of next.offers) {
    const old: Offer | undefined = before.get(offer.id);
    if (!old) {
      changes.push({ kind: "added", at, offer });
      continue;
    }
    if (!sameTiers(old.tiers, offer.tiers)) {
      changes.push({ kind: "tiers", at, offer, before: old.tiers });
    } else if (Math.abs(offer.maxApr - old.maxApr) >= APR_CHANGE_THRESHOLD) {
      changes.push({
        kind: "apr",
        at,
        offer,
        before: old.maxApr,
        after: offer.maxApr,
      });
    }
    if (offer.soldOut !== old.soldOut) {
      changes.push({ kind: offer.soldOut ? "soldOut" : "reopened", at, offer });
    }
  }
  for (const offer of previous.offers) {
    if (!after.has(offer.id)) changes.push({ kind: "removed", at, offer });
  }
  return changes;
}
