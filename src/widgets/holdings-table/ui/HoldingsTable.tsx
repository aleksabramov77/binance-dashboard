"use client";

import {
  type Holding,
  holdingValueUsd,
  type IncomePeriod,
  PLACE_LABELS,
  plannedIncomeUsd,
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
  TableFrame,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

// `yearly` — бывшая «Доход / год», ключ сохранён: сохранённая сортировка продолжает работать (spec 0022).
const SORT_KEYS = [
  "asset",
  "place",
  "amount",
  "usd",
  "apr",
  "yesterday",
  "daily",
  "monthly",
  "yearly",
] as const;
const SORT_TABLE = defineSortTable("portfolio:holdings", SORT_KEYS);
const HELP: Record<(typeof SORT_KEYS)[number], string> = {
  asset: "Монета на вашем счёте Binance.",
  place:
    "Где лежит: спот-кошелёк, Flexible или Locked Earn, фьючерсный кошелёк и т. п.",
  amount: "Количество монет, включая замороженные.",
  usd: "Оценка в долларах по текущей цене.",
  apr: "Годовая ставка, которую сейчас приносит позиция. 0% (красным) — деньги лежат без дохода.",
  yesterday:
    "Сколько Binance начислил по позиции Earn за вчерашние сутки по UTC (с 00:00 до 24:00 UTC) — все виды начислений, в долларах по текущей цене монеты награды. У Spot и Funding начислений нет — «—».",
  daily:
    "Плановый доход за день по текущей ставке: ≈ USD × ставка / 365. Ставка может меняться.",
  monthly:
    "Плановый доход за месяц по текущей ставке: ≈ USD × ставка / 12. Ставка может меняться.",
  yearly:
    "Плановый доход за год по текущей ставке: ≈ USD × ставка. Ставка может меняться.",
};

const INCOME_COLUMNS: {
  key: "daily" | "monthly" | "yearly";
  period: IncomePeriod;
  label: string;
}[] = [
  { key: "daily", period: "day", label: "План / день" },
  { key: "monthly", period: "month", label: "План / мес" },
  { key: "yearly", period: "year", label: "План / год" },
];

const usdOrDash = (value: number | null) =>
  value === null ? "—" : formatUsd(value);

const SORT_VALUE: Record<
  (typeof SORT_KEYS)[number],
  (h: Holding) => SortValue
> = {
  asset: (h) => h.asset,
  place: (h) => PLACE_LABELS[h.place],
  amount: (h) => h.amount + h.frozen,
  usd: (h) => holdingValueUsd(h),
  apr: (h) => h.apr,
  yesterday: (h) => h.yesterdayUsd,
  daily: (h) => plannedIncomeUsd(h, "day"),
  monthly: (h) => plannedIncomeUsd(h, "month"),
  yearly: (h) => plannedIncomeUsd(h, "year"),
};

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const { sort, head } = useTableSort(SORT_TABLE);
  // По умолчанию — самые крупные позиции сверху.
  const rows = sort
    ? sortRows(holdings, SORT_VALUE[sort.key], sort.dir)
    : sortRows(holdings, SORT_VALUE.usd, "desc");
  return (
    <TableFrame>
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
              {...head("yesterday")}
              description={HELP.yesterday}
            >
              Вчера
            </SortableHead>
            {INCOME_COLUMNS.map((c) => (
              <SortableHead
                key={c.key}
                className="text-right"
                {...head(c.key)}
                description={HELP[c.key]}
              >
                {c.label}
              </SortableHead>
            ))}
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
                  {usdOrDash(value)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${h.apr === 0 ? "text-destructive" : ""}`}
                >
                  {formatPercent(h.apr)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {usdOrDash(h.yesterdayUsd)}
                </TableCell>
                {INCOME_COLUMNS.map((c) => (
                  <TableCell
                    key={c.key}
                    className="text-right font-mono tabular-nums"
                  >
                    {usdOrDash(plannedIncomeUsd(h, c.period))}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableFrame>
  );
}
