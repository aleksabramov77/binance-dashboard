"use client";

import { parseAsFloat, useQueryStates } from "nuqs";

export const riskSettingsParsers = {
  capital: parseAsFloat.withDefault(1000),
  riskPct: parseAsFloat.withDefault(0.01),
  maxNotional: parseAsFloat.withDefault(100),
  leverage: parseAsFloat.withDefault(2),
};

export function useRiskSettings() {
  return useQueryStates(riskSettingsParsers, { clearOnDefault: true });
}
