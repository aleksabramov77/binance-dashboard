"use client";

import { useId } from "react";
import { Input } from "@/shared/ui/input";
import { MAX_LEVERAGE } from "../lib/sizePosition";
import { useRiskSettings } from "../model/useRiskSettings";

function NumberField(props: {
  label: string;
  value: number;
  step: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {props.label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={props.min}
        max={props.max}
        step={props.step}
        className="w-32 font-mono"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

export function RiskSettingsBar() {
  const [s, set] = useRiskSettings();
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <NumberField
        label="Капитал, USD"
        value={s.capital}
        step={100}
        min={0}
        onChange={(capital) => set({ capital })}
      />
      <NumberField
        label="Риск на сделку, %"
        value={Number((s.riskPct * 100).toFixed(2))}
        step={0.25}
        min={0}
        max={5}
        onChange={(v) => set({ riskPct: v / 100 })}
      />
      <NumberField
        label="Лимит на сделку, USD"
        value={s.maxNotional}
        step={10}
        min={0}
        onChange={(maxNotional) => set({ maxNotional })}
      />
      <NumberField
        label={`Плечо фьючерсов (≤ ${MAX_LEVERAGE}x)`}
        value={s.leverage}
        step={1}
        min={1}
        max={MAX_LEVERAGE}
        onChange={(leverage) =>
          set({ leverage: Math.min(Math.max(leverage, 1), MAX_LEVERAGE) })
        }
      />
    </div>
  );
}
