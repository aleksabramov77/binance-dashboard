import {
  EARN_KIND_INFO,
  RiskDots,
  type RiskLevel,
} from "@/entities/earn-product";
import {
  type AllocationPlan,
  BUCKET_INFO,
  BUCKET_KINDS,
  type BucketGap,
  type BucketId,
} from "@/features/allocation-advice";
import { cn, formatPercent, formatUsd } from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

const BUCKET_COLORS: Record<BucketId, string> = {
  "simple-flexible": "bg-emerald-500",
  "simple-locked": "bg-emerald-700",
  "stable-yield": "bg-sky-500",
  staking: "bg-indigo-500",
  dual: "bg-orange-500",
  onchain: "bg-rose-500",
  "smart-arbitrage": "bg-amber-500",
};

const GAP_TEXT: Record<BucketGap, string> = {
  "needs-key":
    "Нужен ключ «только чтение»: без него конкретные продукты не подобрать.",
  "catalog-unavailable":
    "Каталог Binance сейчас недоступен — продукты не подобраны.",
  "no-snapshot":
    "Нет снимка Simple Earn — нажмите «Обновить сейчас» на вкладке Simple Earn.",
  "no-products":
    "Не хватило подходящих продуктов с учётом лимитов диверсификации.",
  manual: "Выбирается вручную на binance.com: открытого API нет.",
};

const bucketRisk = (id: BucketId) =>
  Math.max(
    ...BUCKET_KINDS[id].map((k) => EARN_KIND_INFO[k].riskLevel),
  ) as RiskLevel;

/** План распределения суммы: полоса долей, корзины с продуктами, доход и дисклеймер. */
export function AllocationPlanView({ plan }: { plan: AllocationPlan }) {
  if (plan.amountUsd <= 0)
    return (
      <p className="text-sm text-muted-foreground">
        Введите сумму больше нуля, чтобы увидеть план.
      </p>
    );
  const avgApr = plan.expectedIncomeUsd / plan.amountUsd;
  const estimated = plan.buckets.some((b) => b.estimated);
  return (
    <section className="flex flex-col gap-4">
      <div
        className="flex h-4 w-full overflow-hidden rounded-full"
        role="img"
        aria-label="Доли корзин"
      >
        {plan.buckets.map((b) => (
          <div
            key={b.id}
            className={BUCKET_COLORS[b.id]}
            style={{ width: `${b.share * 100}%` }}
            title={`${BUCKET_INFO[b.id].title}: ${formatPercent(b.share)}`}
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Ожидаемый доход в год
            </p>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              ≈ {formatUsd(plan.expectedIncomeUsd)}
            </p>
            <p className="text-xs text-muted-foreground">
              в среднем {formatPercent(avgApr)} годовых
              {estimated && ", часть — оценка по сводке"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Разложено по продуктам
            </p>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatUsd(plan.amountUsd - plan.unfilledUsd)}
            </p>
            <p className="text-xs text-muted-foreground">
              из {formatUsd(plan.amountUsd)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <p className="text-xs text-muted-foreground">Не размещено</p>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatUsd(plan.unfilledUsd)}
            </p>
            <p className="text-xs text-muted-foreground">
              причины — в корзинах ниже
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {plan.buckets.map((b) => (
          <Card key={b.id}>
            <CardHeader>
              <CardTitle className="flex items-start justify-between gap-3 text-base">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-3 shrink-0 rounded-sm",
                      BUCKET_COLORS[b.id],
                    )}
                  />
                  {BUCKET_INFO[b.id].title}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums">
                  {formatPercent(b.share)} · {formatUsd(b.amountUsd)}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <RiskDots level={bucketRisk(b.id)} withLabel />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{BUCKET_INFO[b.id].why}</p>
              {b.picks.length > 0 && (
                <ul className="divide-y">
                  {b.picks.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-baseline justify-between gap-3 py-1.5"
                    >
                      <span>
                        <span className="font-medium">{p.label}</span>
                        {p.note && (
                          <span className="block text-xs text-muted-foreground">
                            {p.note}
                          </span>
                        )}
                      </span>
                      <span className="whitespace-nowrap text-right font-mono tabular-nums">
                        {formatUsd(p.amountUsd)}
                        <span className="block text-xs text-muted-foreground">
                          {formatPercent(p.apr)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {b.gap && b.unplacedUsd > 0.01 && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs">
                  Не размещено {formatUsd(b.unplacedUsd)}. {GAP_TEXT[b.gap]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Доход ≈ {formatUsd(b.expectedIncomeUsd)} в год
                {b.estimated && " (часть — по минимальной ставке сводки)"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
        Это не финансовый совет, а пример распределения по простым правилам.
        Ставки меняются каждый день; расчёт — по текущим ставкам, без учёта
        изменения курса монет и налогов. Решение и подписку на продукты вы
        делаете сами на binance.com.
      </p>
    </section>
  );
}
