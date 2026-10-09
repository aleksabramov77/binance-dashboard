"use client";

import { parseAsFloat, useQueryStates } from "nuqs";
import type { RiskSettings } from "../lib/sizePosition";

/** Риск на сделку — не больше 2% капитала. */
export const MAX_RISK_PCT = 0.02;
const FALLBACK_CAPITAL = 1000;

export const riskSettingsParsers = {
  /** null — «авто»: берём демо-баланс USDT. */
  capital: parseAsFloat,
  riskPct: parseAsFloat.withDefault(0.01),
  maxNotional: parseAsFloat.withDefault(100),
  leverage: parseAsFloat.withDefault(2),
};

export function useRiskSettings() {
  return useQueryStates(riskSettingsParsers, { clearOnDefault: true });
}

/** Настройки для расчёта: капитал «авто» → демо-баланс, риск зажат в 0–2%. */
export function useEffectiveRiskSettings(
  autoCapital: number | null,
): RiskSettings {
  const [s] = useRiskSettings();
  return {
    capital: s.capital ?? (autoCapital || FALLBACK_CAPITAL),
    riskPct: Math.min(Math.max(s.riskPct, 0), MAX_RISK_PCT),
    maxNotional: s.maxNotional,
    leverage: s.leverage,
  };
}
