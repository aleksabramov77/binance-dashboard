"use client";

import {
  type Holding,
  holdingValueUsd,
  PLACE_LABELS,
} from "@/entities/holding";
import {
  defineSortTable,
  formatAmount,
  formatDateTime,
  formatPercent,
  formatUsd,
  type SortValue,
  sortRows,
  useTableSort,
} from "@/shared/lib";
import { SortableHead } from "@/shared/ui/sortable-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

const SORT_KEYS = ["asset", "place", "amount", "usd", "apr", "yearly"] as const;
const SORT_TABLE = defineSortTable("portfolio:holdings", SORT_KEYS);
const HELP: Record<(typeof SORT_KEYS)[number], string> = {
  asset: "Монета на вашем счёте Binance.",
  place:
    "Где лежит: спот-кошелёк, Flexible или Locked Earn, фьючерсный кошелёк и т. п.",
  amount: "Количество монет, включая замороженные.",
  usd: "Оценка в долларах по текущей цене.",
  apr: "Годовая ставка, которую сейчас приносит позиция. 0% (красным) — деньги лежат без дохода.",
  yearly: "Ожидаемый доход за год по текущей ставке.",
};

const SORT_VALUE: Record<
  (typeof SORT_KEYS)[number],
  (h: Holding) => SortValue
> = {
  asset: (h) => h.asset,
  place: (h) => PLACE_LABELS[h.place],
  amount: (h) => h.amount + h.frozen,
  usd: (h) => holdingValueUsd(h),
  apr: (h) => h.apr,
  yearly: (h) => {
    const value = holdingValueUsd(h);
    return value === null ? null : value * h.apr;
  },
};

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const { sort, head } = useTableSort(SORT_TABLE);
  // По умолчанию — самые крупные позиции сверху.
  const rows = sort
    ? sortRows(holdings, SORT_VALUE[sort.key], sort.dir)
    : sortRows(holdings, SORT_VALUE.usd, "desc");
  return (
    <div className="overflow-clip rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead {...head("asset")} description={HELP.asset}>
              Актив
            </SortableHead>
            <SortableHead {...head("place")} description={HELP.place}>
              Где лежит
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("amount")}
              description={HELP.amount}
            >
              Количество
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("usd")}
              description={HELP.usd}
            >
              ≈ USD
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("apr")}
              description={HELP.apr}
            >
              Ставка
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("yearly")}
              description={HELP.yearly}
            >
              Доход / год
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((h) => {
            const value = holdingValueUsd(h);
            return (
              <TableRow
                key={`${h.place}-${h.asset}-${h.productId ?? ""}-${h.until ?? ""}`}
              >
                <TableCell className="font-semibold">{h.asset}</TableCell>
                <TableCell className="text-sm">
                  {PLACE_LABELS[h.place]}
                  {h.place === "locked" && h.until && (
                    <span className="text-muted-foreground">
                      {" "}
                      · до {formatDateTime(h.until)}
                    </span>
                  )}
                  {h.frozen > 0 && h.place !== "locked" && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatAmount(h.frozen)} заморожено
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatAmount(h.amount + h.frozen)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {value === null ? "—" : formatUsd(value)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${h.apr === 0 ? "text-destructive" : ""}`}
                >
                  {formatPercent(h.apr)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {value === null ? "—" : formatUsd(value * h.apr)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
