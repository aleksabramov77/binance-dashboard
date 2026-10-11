"use client";

import { OfferName, TierSummary } from "@/entities/earn-offer";
import type { RankedOffer } from "@/features/offer-filters";
import {
  cn,
  formatAmount,
  formatPercent,
  formatUsd,
  type SortValue,
  sortRows,
  useTableSort,
} from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { SortableHead } from "@/shared/ui/sortable-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

const MAX_ROWS = 200;

const SORT_KEYS = [
  "product",
  "effectiveApr",
  "daily",
  "yearly",
  "maxApr",
  "baseApr",
  "tiers",
  "minimum",
] as const;
const SORT_VALUE: Record<
  (typeof SORT_KEYS)[number],
  (r: RankedOffer) => SortValue
> = {
  product: ({ offer }) => offer.asset,
  effectiveApr: ({ yield: y }) => y?.effectiveApr,
  daily: ({ yield: y }) => y?.yearlyIncomeUsd,
  yearly: ({ yield: y }) => y?.yearlyIncomeUsd,
  maxApr: ({ offer }) => offer.maxApr,
  baseApr: ({ offer }) => offer.baseApr,
  // Бонус ступеней сверх базовой ставки.
  tiers: ({ offer }) => offer.maxApr - offer.baseApr,
  // Минимум в $, чтобы сравнивать разные активы; без цены — в конце.
  minimum: ({ offer }) =>
    !offer.minPurchase
      ? 0
      : offer.priceUsd
        ? offer.minPurchase * offer.priceUsd
        : null,
};

export function OffersTable({ ranked }: { ranked: RankedOffer[] }) {
  // Без выбранной колонки — порядок ранжирования (лучшая ставка сверху).
  const { sort, head } = useTableSort("offersSort", SORT_KEYS);
  const rows = sort ? sortRows(ranked, SORT_VALUE[sort.key], sort.dir) : ranked;
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
            <SortableHead {...head("product")}>Продукт</SortableHead>
            <SortableHead
              className="text-right"
              {...head("effectiveApr", "desc")}
            >
              Ваша ставка
            </SortableHead>
            <SortableHead className="text-right" {...head("daily", "desc")}>
              Доход / день
            </SortableHead>
            <SortableHead className="text-right" {...head("yearly", "desc")}>
              Доход / год
            </SortableHead>
            <SortableHead className="text-right" {...head("maxApr", "desc")}>
              Макс. APR
            </SortableHead>
            <SortableHead className="text-right" {...head("baseApr", "desc")}>
              Базовая
            </SortableHead>
            <SortableHead {...head("tiers", "desc")}>
              Бонусные ступени
            </SortableHead>
            <SortableHead className="text-right" {...head("minimum")}>
              Минимум
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, MAX_ROWS).map(({ offer, yield: y }) => (
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
                {/* Простые проценты: годовой доход / 365 (Flexible начисляет ежедневно). */}
                {y ? formatUsd(y.yearlyIncomeUsd / 365) : "—"}
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
