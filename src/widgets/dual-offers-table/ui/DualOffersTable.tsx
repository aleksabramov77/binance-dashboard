"use client";

import { useState } from "react";
import { type DualOffer, DualOfferName } from "@/entities/earn-product";
import type { RankedDual } from "@/features/offer-filters";
import {
  cn,
  defineSortTable,
  formatDateTime,
  formatPercent,
  formatPpDelta,
  formatPrice,
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
import { DualScenarioDialog } from "./DualScenarioDialog";

const MAX_ROWS = 200;

const SORT_KEYS = [
  "product",
  "strike",
  "settle",
  "price",
  "distance",
  "apr",
  "days",
  "income",
  "edge",
] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SORT_TABLE = defineSortTable("earn:dual", SORT_KEYS);

const HELP: Record<SortKey, string> = {
  product:
    "Монета и направление. Buy Low — вкладываете доллары и готовы купить монету дешевле, чем сейчас. Sell High — вкладываете монету и готовы продать её дороже.",
  strike:
    "Целевая цена. Если на дату расчёта цена дошла до неё, обмен происходит по этой цене.",
  settle: "Дата и время, когда Binance сравнит цену с целевой и вернёт деньги.",
  price: "Цена монеты сейчас.",
  distance:
    "Насколько целевая цена дальше текущей. Чем дальше — тем меньше шанс обмена, но и ставка ниже.",
  apr: "Годовая ставка. Платят при любом исходе, но только за срок продукта.",
  days: "Сколько дней деньги заморожены.",
  income:
    "Доход за срок на вашу сумму в $: ставка × дни / 365. Это не годовой доход.",
  edge: "Насколько ставка выше, чем у Simple Earn Flexible того же актива, который вы вкладываете. Это плата за риск остаться не в той валюте.",
};

const SORT_VALUE: Record<SortKey, (r: RankedDual) => SortValue> = {
  product: ({ offer }) => `${offer.coin} ${offer.side}`,
  strike: ({ offer }) => offer.strikePrice,
  settle: ({ offer }) => offer.settleAt,
  price: ({ offer }) => offer.price,
  distance: ({ distance }) => (distance === null ? null : Math.abs(distance)),
  apr: ({ offer }) => offer.apr,
  days: ({ offer }) => offer.durationDays,
  income: ({ evaluation }) => evaluation?.incomeUsd,
  edge: ({ edge }) => edge,
};

const signedPercent = (value: number) =>
  `${value > 0 ? "+" : ""}${formatPercent(value)}`;

export function DualOffersTable({
  ranked,
  amountUsd,
}: {
  ranked: RankedDual[];
  amountUsd: number;
}) {
  // Без выбранной колонки — порядок ранжирования (превышение над Flexible).
  const { sort, head } = useTableSort(SORT_TABLE);
  const [selected, setSelected] = useState<DualOffer | null>(null);
  const rows = sort ? sortRows(ranked, SORT_VALUE[sort.key], sort.dir) : ranked;
  if (ranked.length === 0)
    return (
      <p className="py-10 text-center text-muted-foreground">
        Под фильтры ничего не подходит.
      </p>
    );
  const right = "text-right";
  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead {...head("product")} description={HELP.product}>
                Продукт
              </SortableHead>
              <SortableHead
                className={right}
                {...head("strike")}
                description={HELP.strike}
              >
                Целевая цена
              </SortableHead>
              <SortableHead {...head("settle")} description={HELP.settle}>
                Дата расчёта
              </SortableHead>
              <SortableHead
                className={right}
                {...head("price")}
                description={HELP.price}
              >
                Цена сейчас
              </SortableHead>
              <SortableHead
                className={right}
                {...head("distance")}
                description={HELP.distance}
              >
                До цели
              </SortableHead>
              <SortableHead
                className={right}
                {...head("apr")}
                description={HELP.apr}
              >
                APR
              </SortableHead>
              <SortableHead
                className={right}
                {...head("days")}
                description={HELP.days}
              >
                Срок
              </SortableHead>
              <SortableHead
                className={right}
                {...head("income")}
                description={HELP.income}
              >
                Доход за срок
              </SortableHead>
              <SortableHead
                className={right}
                {...head("edge")}
                description={HELP.edge}
              >
                vs Flexible
              </SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, MAX_ROWS).map((r) => (
              <TableRow
                key={r.offer.id}
                className="cursor-pointer"
                onClick={() => setSelected(r.offer)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <DualOfferName offer={r.offer} />
                    {r.evaluation?.belowMinimum && (
                      <Badge variant="outline">ниже минимума</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatPrice(r.offer.strikePrice)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDateTime(r.offer.settleAt)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {r.offer.price === null ? "—" : formatPrice(r.offer.price)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.distance === null ? "—" : signedPercent(r.distance)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">
                  {formatPercent(r.offer.apr)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.offer.durationDays} дн.
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.evaluation ? formatUsd(r.evaluation.incomeUsd) : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono tabular-nums",
                    r.edge !== null && r.edge > 0 && "text-positive",
                  )}
                >
                  {r.edge === null ? "—" : formatPpDelta(r.edge)}
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
      <DualScenarioDialog
        offer={selected}
        amountUsd={amountUsd}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
