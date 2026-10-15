"use client";

import { parseAsFloat, parseAsStringLiteral, useQueryStates } from "nuqs";
import { RISK_PROFILES } from "../config/profiles";

const parsers = {
  // Тот же ключ и значение по умолчанию, что у сумм в features/offer-filters (model/parsers.ts):
  // nuqs синхронизирует одинаковые ключи, сумма общая для всех вкладок /earn.
  amount: parseAsFloat.withDefault(1000),
  profile: parseAsStringLiteral(RISK_PROFILES).withDefault("moderate"),
};

/** Сумма и профиль риска калькулятора — в URL (`?amount=5000&profile=conservative`). */
export function useRiskProfile() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
