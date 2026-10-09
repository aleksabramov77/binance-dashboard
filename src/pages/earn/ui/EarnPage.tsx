"use client";

import { Suspense, useMemo } from "react";
import { useEarnOverview } from "@/entities/earn-offer";
import {
  OfferFiltersBar,
  rankOffers,
  useOfferFilters,
} from "@/features/offer-filters";
import { RefreshButton } from "@/features/refresh-snapshot";
import { formatDateTime } from "@/shared/lib";
import { BestOffers } from "@/widgets/best-offers";
import { ChangesFeed } from "@/widgets/changes-feed";
import { OffersTable } from "@/widgets/offers-table";

function EarnDashboard() {
  const { data, isPending, error } = useEarnOverview();
  const [filters] = useOfferFilters();
  const ranked = useMemo(
    () => rankOffers(data?.latest?.offers ?? [], filters),
    [data, filters],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Earn</h1>
          <p className="text-sm text-muted-foreground">
            Simple Earn: где сейчас выгоднее держать деньги.
            {data?.latest &&
              ` Данные от ${formatDateTime(data.latest.fetchedAt)}.`}
          </p>
        </div>
        <RefreshButton />
      </header>

      <OfferFiltersBar />

      {isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {error && <p className="text-destructive">{error.message}</p>}
      {data && !data.latest && (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Снимков ещё нет. Нажмите «Обновить сейчас», чтобы скачать предложения
          с Binance.
        </p>
      )}

      {data?.latest && (
        <>
          <BestOffers ranked={ranked} amountUsd={filters.amount} />
          <div className="grid gap-8 xl:grid-cols-[1fr_380px]">
            <OffersTable ranked={ranked} />
            <ChangesFeed
              changes={data.changes}
              stableOnly={filters.stable}
              snapshotCount={data.snapshotCount}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            «Ваша ставка» — средневзвешенный APR для введённой суммы: бонусные
            ступени действуют только до своего лимита, остаток идёт по базовой
            ставке. Flexible-ставки плавающие.
          </p>
        </>
      )}
    </div>
  );
}

export function EarnPage() {
  return (
    <Suspense>
      <EarnDashboard />
    </Suspense>
  );
}
