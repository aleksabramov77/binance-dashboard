import {
  type Holding,
  holdingValueUsd,
  PLACE_LABELS,
} from "@/entities/holding";
import {
  formatAmount,
  formatDateTime,
  formatPercent,
  formatUsd,
} from "@/shared/lib";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const rows = [...holdings].sort(
    (a, b) => (holdingValueUsd(b) ?? 0) - (holdingValueUsd(a) ?? 0),
  );
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Актив</TableHead>
            <TableHead>Где лежит</TableHead>
            <TableHead className="text-right">Количество</TableHead>
            <TableHead className="text-right">≈ USD</TableHead>
            <TableHead className="text-right">Ставка</TableHead>
            <TableHead className="text-right">Доход / год</TableHead>
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
