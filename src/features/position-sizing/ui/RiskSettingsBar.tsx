"use client";

import { useId } from "react";
import { formatUsd } from "@/shared/lib";
import { Input } from "@/shared/ui/Input";
import { MAX_LEVERAGE } from "../lib/sizePosition";
import { MAX_RISK_PCT, useRiskSettings } from "../model/useRiskSettings";

function NumberField(props: {
  label: string;
  value: number | null;
  placeholder?: string;
  step: number;
  min: number;
  max?: number;
  onChange: (value: number | null) => void;
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
        placeholder={props.placeholder}
        className="w-36 font-mono"
        value={props.value ?? ""}
        onChange={(e) =>
          props.onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    </div>
  );
}

export function RiskSettingsBar({
  autoCapital,
}: {
  /** Демо-баланс USDT для режима «авто»; null — неизвестен. */
  autoCapital: number | null;
}) {
  const [s, set] = useRiskSettings();
  const maxPct = MAX_RISK_PCT * 100;
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <NumberField
        label="Капитал, USD (пусто — авто)"
        value={s.capital}
        placeholder={
          autoCapital ? `авто: ${formatUsd(autoCapital)}` : "авто: $1000"
        }
        step={100}
        min={0}
        onChange={(capital) => set({ capital })}
      />
      <NumberField
        label={`Риск на сделку, % (≤ ${maxPct})`}
        value={Number((Math.min(s.riskPct, MAX_RISK_PCT) * 100).toFixed(2))}
        step={0.25}
        min={0}
        max={maxPct}
        onChange={(v) =>
          set({ riskPct: Math.min(Math.max(v ?? 0, 0), maxPct) / 100 })
        }
      />
      <NumberField
        label="Лимит на сделку, USD"
        value={s.maxNotional}
        step={10}
        min={0}
        onChange={(maxNotional) => set({ maxNotional: maxNotional ?? 0 })}
      />
      <NumberField
        label={`Плечо фьючерсов (≤ ${MAX_LEVERAGE}x)`}
        value={s.leverage}
        step={1}
        min={1}
        max={MAX_LEVERAGE}
        onChange={(leverage) =>
          set({
            leverage: Math.min(Math.max(leverage ?? 1, 1), MAX_LEVERAGE),
          })
        }
      />
    </div>
  );
}
