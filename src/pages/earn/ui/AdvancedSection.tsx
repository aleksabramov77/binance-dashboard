"use client";

import type { ReactNode } from "react";
import {
  type AdvancedCatalog,
  type EarnKind,
  useAdvancedCatalog,
  useEarnSummary,
} from "@/entities/earn-product";
import { formatDateTime } from "@/shared/lib";
import { KindSummaryCards } from "@/widgets/kind-summary";
import { AdvancedAccessNotice } from "./AdvancedAccessNotice";

type OkCatalog = Extract<AdvancedCatalog, { status: "ok" }>;

/** Сводка «ставки сейчас» без ключа — переживает и ошибку каталога, и свою собственную. */
function SummaryFallback({ kinds }: { kinds: readonly EarnKind[] }) {
  const summary = useEarnSummary();
  if (summary.isPending)
    return <p className="text-muted-foreground">Загрузка сводки…</p>;
  if (summary.error)
    return <p className="text-sm text-destructive">{summary.error.message}</p>;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Ставки сейчас</h2>
      <KindSummaryCards items={summary.data.items} kinds={kinds} />
      <p className="text-xs text-muted-foreground">
        Открытая сводка Binance от {formatDateTime(summary.data.fetchedAt)}:
        диапазон годовых ставок по активу. Ставки меняются.
      </p>
    </div>
  );
}

/**
 * Общая обёртка вкладок с каталогом по ключу: загрузка, ошибка Binance, «нет ключа» —
 * со сводкой вместо таблиц; при успехе — содержимое вкладки и предупреждения по группам.
 */
export function AdvancedSection({
  kinds,
  children,
}: {
  kinds: readonly EarnKind[];
  children: (catalog: OkCatalog) => ReactNode;
}) {
  const { data, isPending, error } = useAdvancedCatalog();
  if (isPending)
    return (
      <p className="text-muted-foreground">
        Загрузка каталога Binance… (первый раз — несколько секунд)
      </p>
    );
  const failure = error
    ? error.message
    : data.status === "error"
      ? data.message
      : null;
  if (failure !== null)
    return (
      <div className="flex flex-col gap-6">
        <p className="rounded-xl border border-destructive/50 p-4 text-sm text-destructive">
          Каталог не загрузился: {failure}
        </p>
        <SummaryFallback kinds={kinds} />
      </div>
    );
  if (!data || data.status === "error") return null;
  if (data.status === "not-configured")
    return (
      <div className="flex flex-col gap-6">
        <AdvancedAccessNotice hosting={data.hosting} />
        <SummaryFallback kinds={kinds} />
      </div>
    );
  return (
    <div className="flex flex-col gap-6">
      {data.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/50 p-4 text-sm">
          <p className="font-medium">Часть продуктов не загрузилась:</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {children(data)}
      <p className="text-xs text-muted-foreground">
        Каталог Binance от {formatDateTime(data.fetchedAt)} (обновляется раз в 5
        минут).
      </p>
    </div>
  );
}
