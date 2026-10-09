import type { Mover } from "@/entities/market-signal";
import { cn, formatPrice } from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

function rsiTone(value: number | undefined) {
  if (value === undefined) return "text-muted-foreground";
  if (value >= 70) return "text-destructive";
  if (value <= 30) return "text-positive";
  return "";
}

function MoversTable({ title, movers }: { title: string; movers: Mover[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Монета</TableHead>
              <TableHead className="text-right">Цена</TableHead>
              <TableHead className="text-right">24 ч</TableHead>
              <TableHead className="text-right">Оборот</TableHead>
              <TableHead className="text-right">RSI 1h / 4h</TableHead>
              <TableHead className="pr-6 text-right">От EMA50</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movers.map((m) => {
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
      <MoversTable title="Лидеры роста за 24 ч" movers={gainers} />
      <MoversTable title="Лидеры падения за 24 ч" movers={losers} />
    </div>
  );
}
