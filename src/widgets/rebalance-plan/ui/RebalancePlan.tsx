import { ArrowRight, Lock, Repeat } from "lucide-react";
import { OfferName } from "@/entities/earn-offer";
import { PLACE_LABELS } from "@/entities/holding";
import type { GroupPlan } from "@/features/portfolio-advice";
import { formatAmount, formatPercent, formatUsd } from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

function GroupCard({ plan }: { plan: GroupPlan }) {
  const gain = plan.targetIncomeUsd - plan.currentIncomeUsd;
  const apr = (income: number) =>
    formatPercent(plan.movableUsd > 0 ? income / plan.movableUsd : 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
          <span>
            {plan.label}{" "}
            <span className="font-normal text-muted-foreground">
              · {formatUsd(plan.movableUsd)} без блокировки
            </span>
          </span>
          {plan.moves.length > 0 ? (
            <span className="font-mono text-positive">
              +{formatUsd(gain)} / год
            </span>
          ) : (
            <Badge variant="secondary">уже оптимально</Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Сейчас {apr(plan.currentIncomeUsd)} (
          {formatUsd(plan.currentIncomeUsd)} / год) → по плану{" "}
          <span className="text-foreground">{apr(plan.targetIncomeUsd)}</span> (
          {formatUsd(plan.targetIncomeUsd)} / год)
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Лучшая раскладка
          </h4>
          <ul className="space-y-1.5 text-sm">
            {plan.allocations.map((a) => (
              <li
                key={a.offer.id}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <OfferName offer={a.offer} />
                <span className="font-mono tabular-nums">
                  {formatUsd(a.amountUsd)} ·{" "}
                  {formatPercent(a.incomeUsd / a.amountUsd)} ·{" "}
                  {formatUsd(a.incomeUsd)} / год
                </span>
              </li>
            ))}
          </ul>
        </div>

        {plan.moves.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Что сделать
            </h4>
            <ol className="space-y-2 text-sm">
              {plan.moves.map((m, i) => (
                <li
                  key={`${m.fromAsset}-${m.fromPlace}-${m.to.id}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="w-5 text-muted-foreground">{i + 1}.</span>
                  <span className="font-mono tabular-nums">
                    {formatAmount(m.fromAmount)} {m.fromAsset}
                  </span>
                  <span className="text-muted-foreground">
                    из {PLACE_LABELS[m.fromPlace]}
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  {m.needsSwap && (
                    <Badge variant="outline" className="gap-1">
                      <Repeat className="size-3" /> обменять на {m.to.asset}
                    </Badge>
                  )}
                  <OfferName offer={m.to} />
                </li>
              ))}
            </ol>
          </div>
        )}

        {plan.locked && (
          <div className="rounded-lg border border-dashed p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Lock className="size-4" /> Если готовы заблокировать
            </p>
            <p className="mt-1 text-muted-foreground">
              <OfferName offer={plan.locked.offer} /> под{" "}
              {formatPercent(plan.locked.apr)} на{" "}
              {formatUsd(plan.locked.amountUsd)} — ещё{" "}
              <span className="text-positive">
                +{formatUsd(plan.locked.extraIncomeUsd)} / год
              </span>{" "}
              сверх Flexible-плана, но деньги будут недоступны{" "}
              {plan.locked.offer.durationDays} дн.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RebalancePlan({ plans }: { plans: GroupPlan[] }) {
  if (plans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Свободных денег для перекладки нет.
      </p>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {plans.map((plan) => (
        <GroupCard key={plan.key} plan={plan} />
      ))}
    </div>
  );
}
