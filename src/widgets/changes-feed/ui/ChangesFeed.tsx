import {
  type OfferChange,
  OfferName,
  TierSummary,
} from "@/entities/earn-offer";
import { formatDateTime, formatPercent, formatPpDelta } from "@/shared/lib";
import { Badge } from "@/shared/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/Card";

const MAX_ITEMS = 60;

function ChangeDetails({ change }: { change: OfferChange }) {
  switch (change.kind) {
    case "added":
      return (
        <>
          <Badge className="bg-positive text-background">новое</Badge>
          <span className="font-mono tabular-nums">
            {formatPercent(change.offer.maxApr)}
          </span>
        </>
      );
    case "removed":
      return <Badge variant="destructive">убрали</Badge>;
    case "apr": {
      const up = change.after > change.before;
      return (
        <span className="font-mono tabular-nums">
          {formatPercent(change.before)} → {formatPercent(change.after)}{" "}
          <span className={up ? "text-positive" : "text-destructive"}>
            {formatPpDelta(change.after - change.before)}
          </span>
        </span>
      );
    }
    case "tiers":
      return (
        <div className="flex items-start gap-2">
          <Badge variant="secondary">новые ступени</Badge>
          <TierSummary offer={change.offer} />
        </div>
      );
    case "soldOut":
      return <Badge variant="outline">распродано</Badge>;
    case "reopened":
      return (
        <Badge className="bg-positive text-background">снова доступно</Badge>
      );
  }
}

interface ChangesFeedProps {
  changes: OfferChange[];
  stableOnly: boolean;
  snapshotCount: number;
}

export function ChangesFeed({
  changes,
  stableOnly,
  snapshotCount,
}: ChangesFeedProps) {
  const visible = changes
    .filter((c) => (stableOnly ? c.offer.stablecoin : true))
    .slice(0, MAX_ITEMS);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Что изменилось</CardTitle>
      </CardHeader>
      <CardContent>
        {snapshotCount < 2 ? (
          <p className="text-sm text-muted-foreground">
            Пока один снимок. Изменения появятся после следующего обновления.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Заметных изменений нет.
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((change) => (
              <li
                key={`${change.at}-${change.kind}-${change.offer.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="w-28 shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(change.at)}
                </span>
                <OfferName offer={change.offer} />
                <ChangeDetails change={change} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
