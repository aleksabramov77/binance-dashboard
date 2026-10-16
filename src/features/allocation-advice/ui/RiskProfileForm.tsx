"use client";

import { useId } from "react";
import { Input } from "@/shared/ui/Input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/Tabs";
import {
  PROFILE_DESCRIPTIONS,
  PROFILE_LABELS,
  RISK_PROFILES,
  type RiskProfile,
} from "../config/profiles";
import { useRiskProfile } from "../model/useRiskProfile";

export function RiskProfileForm() {
  const [{ amount, profile }, setProfile] = useRiskProfile();
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={id}
            className="text-xs font-medium text-muted-foreground"
          >
            Сколько хотите разложить, USD
          </label>
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            className="w-40 font-mono text-base"
            value={amount}
            onChange={(e) =>
              setProfile({ amount: Number(e.target.value) || 0 })
            }
          />
        </div>
        <Tabs
          value={profile}
          onValueChange={(v) => setProfile({ profile: v as RiskProfile })}
        >
          <TabsList>
            {RISK_PROFILES.map((p) => (
              <TabsTrigger key={p} value={p}>
                {PROFILE_LABELS[p]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <p className="text-sm text-muted-foreground">
        {PROFILE_DESCRIPTIONS[profile]}
      </p>
    </div>
  );
}
