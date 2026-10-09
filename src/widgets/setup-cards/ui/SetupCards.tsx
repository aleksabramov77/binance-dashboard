import { DirectionBadge, type Setup } from "@/entities/market-signal";
import type { TradeOverview } from "@/entities/trade";
import { type RiskSettings, sizePosition } from "@/features/position-sizing";
import { TradeTicketDialog } from "@/features/trade-ticket";
import { cn, formatAmount, formatPrice, formatUsd } from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

const KIND_LABELS: Record<Setup["kind"], string> = {
  "rebound-long": "Отскок после падения",
  "overheat-short": "Перегрев после роста",
};

function Level({
  label,
  price,
  entry,
  tone,
}: {
  label: string;
  price: number;
  entry: number;
  tone?: string;
}) {
  const diff = (price - entry) / entry;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular-nums", tone)}>
        {formatPrice(price)}{" "}
        <span className="text-xs text-muted-foreground">
          ({diff > 0 ? "+" : ""}
          {(diff * 100).toFixed(1).replace(".", ",")}%)
        </span>
      </span>
    </div>
  );
}

function SetupCard({
  setup,
  settings,
  overview,
}: {
  setup: Setup;
  settings: RiskSettings;
  overview: TradeOverview | undefined;
}) {
  const size = sizePosition(setup, settings);
  return (
    <Card
      className={setup.status === "ready" ? "border-primary/50" : undefined}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <DirectionBadge direction={setup.direction} />
          <span className="font-semibold">{setup.base}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {setup.market === "spot" ? "Spot" : `Фьючерс ×${size.leverage}`}
          </span>
          <Badge
            variant={setup.status === "ready" ? "default" : "outline"}
            className="ml-auto"
          >
            {setup.status === "ready" ? "можно входить" : "ждём разворота"}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {KIND_LABELS[setup.kind]} · R:R{" "}
          {setup.rr.toFixed(1).replace(".", ",")} · сила{" "}
          {Math.round(setup.strength * 100)}%
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1 rounded-lg bg-muted/50 p-3">
          <Level label="Вход (рынок)" price={setup.entry} entry={setup.entry} />
          <Level
            label="Stop Loss"
            price={setup.stopLoss}
            entry={setup.entry}
            tone="text-destructive"
          />
          <Level
            label="Take Profit 1 (EMA20)"
            price={setup.takeProfit1}
            entry={setup.entry}
            tone="text-positive"
          />
          <Level
            label="Take Profit 2 (EMA50)"
            price={setup.takeProfit2}
            entry={setup.entry}
            tone="text-positive"
          />
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-muted-foreground">Объём</span>
          <span className="text-right font-mono tabular-nums">
            {formatAmount(size.quantity)} {setup.base} ·{" "}
            {formatUsd(size.notionalUsd)}
          </span>
          <span className="text-muted-foreground">
            {setup.market === "spot" ? "Нужно денег" : "Маржа"}
          </span>
          <span className="text-right font-mono tabular-nums">
            {formatUsd(size.marginUsd)}
          </span>
          <span className="text-muted-foreground">Если стоп</span>
          <span className="text-right font-mono tabular-nums text-destructive">
            −{formatUsd(size.lossAtStopUsd)}
          </span>
          <span className="text-muted-foreground">Если TP1 / TP2</span>
          <span className="text-right font-mono tabular-nums text-positive">
            +{formatUsd(size.profitAtTp1Usd)} / +
            {formatUsd(size.profitAtTp2Usd)}
          </span>
        </div>
        {size.cappedByLimit && (
          <p className="text-xs text-muted-foreground">
            Объём урезан лимитом на сделку — риск меньше заданного.
          </p>
        )}

        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {setup.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>

        <TradeTicketDialog
          setup={setup}
          quantity={size.quantity}
          leverage={size.leverage}
          overview={overview}
        />
      </CardContent>
    </Card>
  );
}

export function SetupCards({
  setups,
  settings,
  overview,
}: {
  setups: Setup[];
  settings: RiskSettings;
  overview: TradeOverview | undefined;
}) {
  if (setups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Сейчас среди лидеров роста и падения нет сетапов, подходящих под
        правила. Это нормально — лучше пропустить, чем войти без сигнала.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {setups.map((s) => (
        <SetupCard
          key={s.id}
          setup={s}
          settings={settings}
          overview={overview}
        />
      ))}
    </div>
  );
}
