import {
  aprRange,
  EARN_KIND_INFO,
  type EarnKind,
  type KindSummary,
  RiskDots,
} from "@/entities/earn-product";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

/** Карточки «ставки сейчас» по видам из публичной сводки Binance (работает без ключа). */
export function KindSummaryCards({
  items,
  kinds,
}: {
  items: KindSummary[];
  kinds: readonly EarnKind[];
}) {
  const cards = kinds
    .map((kind) => ({ kind, rows: items.filter((i) => i.kind === kind) }))
    .filter((c) => c.rows.length > 0);
  if (cards.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        В сводке Binance сейчас нет ставок по этим продуктам.
      </p>
    );
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ kind, rows }) => (
        <Card key={kind}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              {EARN_KIND_INFO[kind].title}
              <RiskDots level={EARN_KIND_INFO[kind].riskLevel} />
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {EARN_KIND_INFO[kind].tagline}
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {rows.map((r) => (
                <li
                  key={r.asset}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {r.asset}
                    {r.lowRisk && <Badge variant="outline">низкий риск</Badge>}
                    {r.soldOut && <Badge variant="outline">распродано</Badge>}
                  </span>
                  <span className="font-mono tabular-nums">
                    {aprRange(r.minApr, r.maxApr)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
