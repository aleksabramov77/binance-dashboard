import type { Offer } from "../model/schema";

export function offerTermLabel(offer: Offer): string {
  return offer.type === "flexible"
    ? "Flexible"
    : `Locked ${offer.durationDays} дн.`;
}

export function OfferName({ offer }: { offer: Offer }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="font-semibold">{offer.asset}</span>
      <span className="text-xs text-muted-foreground">
        {offerTermLabel(offer)}
      </span>
    </span>
  );
}
