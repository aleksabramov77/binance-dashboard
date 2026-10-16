"use client";

import { useId } from "react";
import { Input } from "@/shared/ui/Input";
import { Switch } from "@/shared/ui/Switch";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/Tabs";
import {
  OFFER_TYPES,
  type OfferTypeFilter,
  useOfferFilters,
} from "../model/useOfferFilters";

const TYPE_LABELS: Record<OfferTypeFilter, string> = {
  all: "Все",
  flexible: "Flexible",
  locked: "Locked",
};

export function OfferFiltersBar() {
  const [filters, setFilters] = useOfferFilters();
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-amount`}
          className="text-xs font-medium text-muted-foreground"
        >
          Сумма, USD
        </label>
        <Input
          id={`${id}-amount`}
          type="number"
          inputMode="decimal"
          min={0}
          step={100}
          className="w-36 font-mono text-base"
          value={filters.amount}
          onChange={(e) => setFilters({ amount: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-q`}
          className="text-xs font-medium text-muted-foreground"
        >
          Монета
        </label>
        <Input
          id={`${id}-q`}
          placeholder="USDT, BTC…"
          className="w-36"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
        />
      </div>
      <Tabs
        value={filters.type}
        onValueChange={(v) => setFilters({ type: v as OfferTypeFilter })}
      >
        <TabsList>
          {OFFER_TYPES.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TYPE_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex h-9 items-center gap-2 text-sm">
        <Switch
          id={`${id}-stable`}
          checked={filters.stable}
          onCheckedChange={(stable) => setFilters({ stable })}
        />
        <label htmlFor={`${id}-stable`}>Только стейблкоины</label>
      </div>
      <div className="flex h-9 items-center gap-2 text-sm">
        <Switch
          id={`${id}-sold-out`}
          checked={filters.hideSoldOut}
          onCheckedChange={(hideSoldOut) => setFilters({ hideSoldOut })}
        />
        <label htmlFor={`${id}-sold-out`}>Скрыть распроданные</label>
      </div>
    </div>
  );
}
