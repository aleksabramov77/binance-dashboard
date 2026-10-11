"use client";

import type { Mover } from "@/entities/market-signal";
import {
  cn,
  formatPrice,
  type SortValue,
  sortRows,
  useTableSort,
} from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { SortableHead } from "@/shared/ui/sortable-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

function rsiTone(value: number | undefined) {
  if (value === undefined) return "text-muted-foreground";
  if (value >= 70) return "text-destructive";
  if (value <= 30) return "text-positive";
  return "";
}

const SORT_KEYS = ["coin", "price", "change", "volume", "rsi", "ema"] as const;
const SORT_VALUE: Record<(typeof SORT_KEYS)[number], (m: Mover) => SortValue> =
  {
    coin: (m) => m.base,
    price: (m) => m.price,
    change: (m) => m.change24h,
    volume: (m) => m.quoteVolumeUsd,
    rsi: (m) => m.indicators?.rsi1h,
    ema: (m) => m.indicators?.distanceAtr,
  };

function MoversTable({
  title,
  movers,
  sortParam,
}: {
  title: string;
  movers: Mover[];
  /** Параметр URL сортировки: на странице две таблицы, у каждой свой. */
  sortParam: string;
}) {
  const { sort, head } = useTableSort(sortParam, SORT_KEYS);
  const rows = sort ? sortRows(movers, SORT_VALUE[sort.key], sort.dir) : movers;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead className="pl-6" {...head("coin")}>
                Монета
              </SortableHead>
              <SortableHead className="text-right" {...head("price", "desc")}>
                Цена
              </SortableHead>
              <SortableHead className="text-right" {...head("change", "desc")}>
                24 ч
              </SortableHead>
              <SortableHead className="text-right" {...head("volume", "desc")}>
                Оборот
              </SortableHead>
              <SortableHead className="text-right" {...head("rsi", "desc")}>
                RSI 1h / 4h
              </SortableHead>
              <SortableHead
                className="pr-6 text-right"
                {...head("ema", "desc")}
              >
                От EMA50
              </SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => {
              const ind = m.indicators;
              return (
                <TableRow key={m.symbol}>
                  <TableCell className="pl-6">
                    <span className="font-semibold">{m.base}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {[m.spot && "Spot", m.futures && "Perp"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPrice(m.price)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      m.change24h >= 0 ? "text-positive" : "text-destructive",
                    )}
                  >
                    {m.change24h > 0 ? "+" : ""}
                    {(m.change24h * 100).toFixed(1).replace(".", ",")}%
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {Math.round(m.quoteVolumeUsd / 1e6).toLocaleString("ru-RU")}{" "}
                    млн $
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span className={rsiTone(ind?.rsi1h)}>
                      {ind ? ind.rsi1h.toFixed(0) : "—"}
                    </span>
                    <span className="text-muted-foreground"> / </span>
                    <span className={rsiTone(ind?.rsi4h)}>
                      {ind ? ind.rsi4h.toFixed(0) : "—"}
                    </span>
                  </TableCell>
                  <TableCell className="pr-6 text-right font-mono tabular-nums">
                    {ind
                      ? `${ind.distanceAtr > 0 ? "+" : ""}${ind.distanceAtr.toFixed(1).replace(".", ",")} ATR`
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function MarketMovers({
  gainers,
  losers,
}: {
  gainers: Mover[];
  losers: Mover[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <MoversTable
        title="Лидеры роста за 24 ч"
        movers={gainers}
        sortParam="gainersSort"
      />
      <MoversTable
        title="Лидеры падения за 24 ч"
        movers={losers}
        sortParam="losersSort"
      />
    </div>
  );
}
