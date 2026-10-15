"use client";

import { useMemo } from "react";
import { useEarnOverview } from "@/entities/earn-offer";
import {
  type KindTab,
  useAdvancedCatalog,
  useEarnSummary,
} from "@/entities/earn-product";
import {
  buildAllocation,
  fillAllocation,
  RiskProfileForm,
  useRiskProfile,
} from "@/features/allocation-advice";
import { AllocationPlanView } from "@/widgets/allocation-plan";
import { EarnGuide } from "@/widgets/earn-guide";

export function GuideTab({ onOpenTab }: { onOpenTab: (tab: KindTab) => void }) {
  const [{ amount, profile }] = useRiskProfile();
  const simple = useEarnOverview();
  const catalog = useAdvancedCatalog();
  const summary = useEarnSummary();
  const plan = useMemo(
    () =>
      fillAllocation(
        buildAllocation(amount, profile),
        {
          simpleOffers: simple.data?.latest?.offers ?? null,
          catalog: catalog.data ?? null,
          summary: summary.data?.items ?? null,
        },
        profile,
      ),
    [amount, profile, simple.data, catalog.data, summary.data],
  );
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Калькулятор распределения</h2>
          <p className="text-sm text-muted-foreground">
            Введите сумму и выберите, насколько готовы рисковать, — план
            разложит её по видам Earn по правилам диверсификации ниже.
          </p>
        </div>
        <RiskProfileForm />
        {catalog.isPending && (
          <p className="text-xs text-muted-foreground">
            Загружаем каталог Binance — корзины Dual, стейкинга и DeFi
            заполнятся через несколько секунд.
          </p>
        )}
        <AllocationPlanView plan={plan} />
      </section>
      <EarnGuide summary={summary.data?.items} onOpenTab={onOpenTab} />
    </div>
  );
}
