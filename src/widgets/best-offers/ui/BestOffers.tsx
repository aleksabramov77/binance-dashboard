import { OfferName } from "@/entities/earn-offer";
import type { RankedOffer } from "@/features/offer-filters";
import { formatAmount, formatPercent, formatUsd } from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface BestOffersProps {
  ranked: RankedOffer[];
  amountUsd: number;
}

export function BestOffers({ ranked, amountUsd }: BestOffersProps) {
  const top = ranked
    .filter((r) => r.yield && !r.yield.belowMinimum)
    .slice(0, 3);
  if (top.length === 0) return null;
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {top.map(({ offer, yield: y }, index) =>
        y ? (
          <Card
            key={offer.id}
            className={
              index === 0 ? "border-primary/60 bg-accent/40" : undefined
            }
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <OfferName offer={offer} />
                <span className="text-xs font-normal text-muted-foreground">
                  #{index + 1}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-mono text-3xl font-semibold tabular-nums">
                {formatPercent(y.effectiveApr)}
              </p>
              <p className="text-sm text-muted-foreground">
                ≈ {formatUsd(y.yearlyIncomeUsd)} в год с {formatUsd(amountUsd)}{" "}
                · {formatUsd(y.yearlyIncomeUsd / 12)} в месяц
              </p>
              {y.bonusCapUsd !== null && amountUsd > y.bonusCapUsd && (
                <p className="text-xs text-muted-foreground">
                  Бонус до{" "}
                  {offer.stablecoin
                    ? `${formatAmount(Math.max(...offer.tiers.map((t) => t.to)))} ${offer.asset}`
                    : formatUsd(y.bonusCapUsd)}
                  : на эту часть {formatPercent(offer.maxApr)}, на остаток
                  только {formatPercent(offer.baseApr)}.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null,
      )}
    </section>
  );
}
