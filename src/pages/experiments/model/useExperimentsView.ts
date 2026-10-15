"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";

export const MARKET_FILTERS = ["all", "spot", "futures"] as const;

export type MarketFilter = (typeof MARKET_FILTERS)[number];

const parsers = {
  market: parseAsStringLiteral(MARKET_FILTERS).withDefault("all"),
};

/** Фильтр по рынку /experiments — в URL; сортировка таблицы — в localStorage (spec 009). */
export function useExperimentsView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
