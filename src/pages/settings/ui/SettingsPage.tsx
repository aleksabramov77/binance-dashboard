"use client";

import { useLabSettings } from "@/entities/experiment";
import { BudgetCard } from "./BudgetCard";
import { EpochCard } from "./EpochCard";
import { ExperimentsCard } from "./ExperimentsCard";

// /settings — настройки Лаборатории экспериментов (spec 003, задача 3d).
export function SettingsPage() {
  const settings = useLabSettings();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Лаборатория экспериментов: текущая эпоха учёта, сброс тестовых
          капиталов, стартовый бюджет и включение отдельных экспериментов. Всё
          здесь — paper-торговля, реальные ордера не отправляются.
        </p>
      </header>
      {settings.isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {settings.error && (
        <p className="text-destructive">{settings.error.message}</p>
      )}
      {settings.data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <EpochCard settings={settings.data} />
            <BudgetCard settings={settings.data} />
          </div>
          <ExperimentsCard experiments={settings.data.experiments} />
        </>
      )}
    </div>
  );
}
