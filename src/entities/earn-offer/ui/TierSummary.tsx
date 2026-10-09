import { formatAmount, formatPercent, formatUsd } from "@/shared/lib";
import type { Offer } from "../model/schema";

/** «+2,00% до 10 000 USDC (≈ $10 000)» для каждой бонусной ступени. */
export function TierSummary({ offer }: { offer: Offer }) {
  if (offer.tiers.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5">
      {offer.tiers.map((t) => (
        <li key={`${t.from}-${t.to}`} className="whitespace-nowrap">
          <span className="font-medium text-positive">
            +{formatPercent(t.bonusApr)}
          </span>{" "}
          <span className="text-muted-foreground">
            {t.from > 0 ? `${formatAmount(t.from)}–` : "до "}
            {formatAmount(t.to)} {offer.asset}
            {offer.priceUsd && !offer.stablecoin
              ? ` (≈ ${formatUsd(t.to * offer.priceUsd)})`
              : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
