"use client";

import { useId } from "react";
import { Input } from "@/shared/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  DUAL_SIDE_FILTERS,
  type DualSideFilter,
  useDualFilters,
} from "../model/useDualFilters";
import { AmountField } from "./AmountField";

const SIDE_LABELS: Record<DualSideFilter, string> = {
  all: "Все",
  "buy-low": "Buy Low",
  "sell-high": "Sell High",
};

/** Фильтры Dual Investment — в URL; сумма общая со всеми вкладками. */
export function DualFiltersBar({ coins }: { coins: string[] }) {
  const [filters, setFilters] = useDualFilters();
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <AmountField />
      <Tabs
        value={filters.dcoin || "all"}
        onValueChange={(v) => setFilters({ dcoin: v === "all" ? "" : v })}
      >
        <TabsList>
          <TabsTrigger value="all">Все монеты</TabsTrigger>
          {coins.map((c) => (
            <TabsTrigger key={c} value={c}>
              {c}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tabs
        value={filters.side}
        onValueChange={(v) => setFilters({ side: v as DualSideFilter })}
      >
        <TabsList>
          {DUAL_SIDE_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {SIDE_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-days`}
          className="text-xs font-medium text-muted-foreground"
        >
          Срок до, дней (0 — любой)
        </label>
        <Input
          id={`${id}-days`}
          type="number"
          min={0}
          className="w-28 font-mono"
          value={filters.maxDays}
          onChange={(e) =>
            setFilters({
              maxDays: Math.max(0, Math.round(Number(e.target.value) || 0)),
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-dist`}
          className="text-xs font-medium text-muted-foreground"
        >
          Цель не ближе, % от цены
        </label>
        <Input
          id={`${id}-dist`}
          type="number"
          min={0}
          step={0.5}
          className="w-28 font-mono"
          value={filters.minDist}
          onChange={(e) =>
            setFilters({ minDist: Math.max(0, Number(e.target.value) || 0) })
          }
        />
      </div>
    </div>
  );
}
