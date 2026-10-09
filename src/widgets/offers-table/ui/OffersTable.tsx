import { OfferName, TierSummary } from "@/entities/earn-offer";
import type { RankedOffer } from "@/features/offer-filters";
import { cn, formatAmount, formatPercent, formatUsd } from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

const MAX_ROWS = 200;

export function OffersTable({ ranked }: { ranked: RankedOffer[] }) {
  if (ranked.length === 0) {
    return (
      <p className="py-10 text-center text-muted-foreground">
        Под фильтры ничего не подходит.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Продукт</TableHead>
            <TableHead className="text-right">Ваша ставка</TableHead>
            <TableHead className="text-right">Доход / год</TableHead>
            <TableHead className="text-right">Макс. APR</TableHead>
            <TableHead className="text-right">Базовая</TableHead>
            <TableHead>Бонусные ступени</TableHead>
            <TableHead className="text-right">Минимум</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ranked.slice(0, MAX_ROWS).map(({ offer, yield: y }) => (
            <TableRow
              key={offer.id}
              className={cn(offer.soldOut && "opacity-50")}
            >
              <TableCell>
                <div className="flex items-center gap-2">
                  <OfferName offer={offer} />
                  {offer.soldOut && <Badge variant="outline">распродано</Badge>}
                  {y?.belowMinimum && (
                    <Badge variant="outline">ниже минимума</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {y ? formatPercent(y.effectiveApr) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {y ? formatUsd(y.yearlyIncomeUsd) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPercent(offer.maxApr)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                {formatPercent(offer.baseApr)}
              </TableCell>
              <TableCell className="text-sm">
                <TierSummary offer={offer} />
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {offer.minPurchase
                  ? `${formatAmount(offer.minPurchase)} ${offer.asset}`
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {ranked.length > MAX_ROWS && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Показаны первые {MAX_ROWS} из {ranked.length}. Уточните фильтры.
        </p>
      )}
    </div>
  );
}
