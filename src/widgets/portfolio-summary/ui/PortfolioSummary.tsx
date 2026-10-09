import { type Holding, holdingValueUsd, type Wallet } from "@/entities/holding";
import type { GroupPlan } from "@/features/portfolio-advice";
import { formatPercent, formatUsd } from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface PortfolioSummaryProps {
  holdings: Holding[];
  wallets: Wallet[];
  plans: GroupPlan[];
}

function Stat({
  title,
  value,
  hint,
  accent,
}: {
  title: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-primary/60 bg-accent/40" : undefined}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="font-mono text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function PortfolioSummary({
  holdings,
  wallets,
  plans,
}: PortfolioSummaryProps) {
  const totalUsd = wallets.reduce((s, w) => s + w.balanceUsd, 0);
  const earningIncome = holdings.reduce(
    (s, h) => s + (holdingValueUsd(h) ?? 0) * h.apr,
    0,
  );
  const earnUsd = holdings.reduce(
    (s, h) => s + (h.apr > 0 ? (holdingValueUsd(h) ?? 0) : 0),
    0,
  );
  const gain = plans.reduce(
    (s, p) =>
      s + (p.moves.length > 0 ? p.targetIncomeUsd - p.currentIncomeUsd : 0),
    0,
  );

  return (
    <section className="space-y-3">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          title="Всего на Binance"
          value={formatUsd(totalUsd)}
          hint={`из них в Earn ${formatUsd(earnUsd)}`}
        />
        <Stat
          title="Приносит сейчас"
          value={`${formatUsd(earningIncome)} / год`}
          hint={
            totalUsd > 0
              ? `≈ ${formatPercent(earningIncome / totalUsd)} на весь баланс`
              : "—"
          }
        />
        <Stat
          title="Если сделать план"
          value={gain > 0 ? `+${formatUsd(gain)} / год` : "Уже оптимально"}
          hint={
            gain > 0
              ? `≈ +${formatUsd(gain / 12)} в месяц сверх текущего`
              : "Заметно выгоднее разложить нельзя"
          }
          accent={gain > 0}
        />
      </div>
      {wallets.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {wallets.map((w) => (
            <span key={w.name}>
              {w.name}:{" "}
              <span className="font-mono text-foreground">
                {formatUsd(w.balanceUsd)}
              </span>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
