"use client";

import { useMemo } from "react";
import { useEarnOverview } from "@/entities/earn-offer";
import type { DualOffer } from "@/entities/earn-product";
import {
  DualFiltersBar,
  rankDualOffers,
  useDualFilters,
} from "@/features/offer-filters";
import { DualOffersTable } from "@/widgets/dual-offers-table";
import { AdvancedSection } from "./AdvancedSection";

const KINDS = ["dual"] as const;

function DualCatalog({ offers }: { offers: DualOffer[] }) {
  const [filters] = useDualFilters();
  const simple = useEarnOverview();
  const ranked = useMemo(
    () => rankDualOffers(offers, simple.data?.latest?.offers ?? [], filters),
    [offers, simple.data, filters],
  );
  const coins = useMemo(
    () => [...new Set(offers.map((o) => o.coin))],
    [offers],
  );
  if (offers.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        Сейчас предложений нет.
      </p>
    );
  return (
    <div className="flex flex-col gap-6">
      <DualFiltersBar coins={coins} />
      <DualOffersTable ranked={ranked} amountUsd={filters.amount} />
      <p className="text-xs text-muted-foreground">
        Нажмите на строку, чтобы увидеть оба исхода простыми словами. Капитал в
        Dual не защищён: можно остаться не в той валюте. «vs Flexible» —
        сравнение с лучшей ставкой Simple Earn Flexible того же актива из
        последнего снимка.
      </p>
    </div>
  );
}

export function DualTab() {
  return (
    <AdvancedSection kinds={KINDS}>
      {(catalog) => <DualCatalog offers={catalog.dual} />}
    </AdvancedSection>
  );
}
