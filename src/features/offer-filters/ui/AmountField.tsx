"use client";

import { useId } from "react";
import { Input } from "@/shared/ui/Input";
import { useOfferFilters } from "../model/useOfferFilters";

/** Поле «Сумма, USD» — общий `?amount` всех вкладок /earn. */
export function AmountField() {
  const [{ amount }, setFilters] = useOfferFilters();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Сумма, USD
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={100}
        className="w-36 font-mono text-base"
        value={amount}
        onChange={(e) => setFilters({ amount: Number(e.target.value) || 0 })}
      />
    </div>
  );
}
