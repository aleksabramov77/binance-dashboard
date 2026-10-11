"use client";

import { useLabSettings } from "@/entities/experiment";
import { BudgetCard } from "./BudgetCard";
import { DemoAccountsCard } from "./DemoAccountsCard";
import { EpochCard } from "./EpochCard";
import { PaperAccountsCard } from "./PaperAccountsCard";

// /settings — настройки Лаборатории экспериментов (spec 003, задача 3d).
export function SettingsPage() {
  const settings = useLabSettings();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Два счёта лаборатории — отдельно: <b>Paper</b> (симуляция на бумаге,
          без ордеров) и <b>демо-счёт Binance</b> (реальные ордера на
          demo.binance.com с виртуальными деньгами). Сбросить можно любой
          эксперимент отдельно или все сразу — в своём блоке.
        </p>
      </header>
      {settings.isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {settings.error && (
        <p className="text-destructive">{settings.error.message}</p>
      )}
      {settings.data && (
        <>
          <h2 className="text-lg font-semibold">Paper — симуляция</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <EpochCard settings={settings.data} />
            <BudgetCard settings={settings.data} />
          </div>
          <PaperAccountsCard experiments={settings.data.experiments} />
          <h2 className="text-lg font-semibold">Binance Demo — демо-счёт</h2>
          <DemoAccountsCard settings={settings.data} />
        </>
      )}
    </div>
  );
}
