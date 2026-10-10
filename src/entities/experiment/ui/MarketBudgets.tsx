"use client";

import { cn, formatUsd } from "@/shared/lib";
import { useExperimentBudgets } from "../api/useExperimentBudgets";
import type { MarketBudget } from "../model/budget";

const MARKET_LABEL: Record<MarketBudget["market"], string> = {
  spot: "Spot",
  futures: "Futures",
};

const signed = (v: number, text: string) => (v > 0 ? `+${text}` : text);

const pct = (v: number) =>
  signed(
    v,
    `${(v * 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
  );

function tooltip(b: MarketBudget): string {
  return [
    `${MARKET_LABEL[b.market]} — бюджет лаборатории в текущей эпохе`,
    `Старт: ${formatUsd(b.initial)}`,
    `Изменение: ${signed(b.change, formatUsd(b.change))} (${pct(b.changePct)})`,
    `Реализованный PnL (после комиссий): ${signed(b.realized, formatUsd(b.realized))}`,
    `Комиссии закрытых сделок: ${formatUsd(b.fees)}`,
    b.unrealized === null
      ? `Открытых позиций: ${b.openTrades} — нет цен, в equity не учтены`
      : `Открытых позиций: ${b.openTrades}, нереализованный PnL: ${signed(b.unrealized, formatUsd(b.unrealized))}`,
  ].join("\n");
}

function BudgetItem({ budget }: { budget: MarketBudget }) {
  const tone =
    budget.change > 0
      ? "text-positive"
      : budget.change < 0
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div
      className="flex shrink-0 items-baseline gap-1.5 font-mono text-xs tabular-nums whitespace-nowrap"
      title={tooltip(budget)}
    >
      <span className="font-sans text-muted-foreground">
        {MARKET_LABEL[budget.market]}
      </span>
      <span>{formatUsd(budget.equity)}</span>
      <span className={tone}>
        {/* На узком экране — только проценты: $ остаются в подсказке. */}
        <span className="hidden sm:inline">
          {signed(budget.change, formatUsd(budget.change))} ·{" "}
        </span>
        {pct(budget.changePct)}
      </span>
    </div>
  );
}

/** Equity лаборатории по рынкам (Spot / Futures) и изменение от старта эпохи. */
export function MarketBudgets({ className }: { className?: string }) {
  const { data, error } = useExperimentBudgets();
  if (error)
    return (
      <span
        className={cn("text-xs text-muted-foreground", className)}
        title={`Бюджеты: ${error.message}`}
      >
        Бюджеты: —
      </span>
    );
  if (!data) return null;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}
    >
      {data.markets.map((b) => (
        <BudgetItem key={b.market} budget={b} />
      ))}
    </div>
  );
}
