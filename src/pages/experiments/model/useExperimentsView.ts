"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";

export const MARKET_FILTERS = ["all", "spot", "futures"] as const;
export const SORT_KEYS = [
  "id",
  "ag",
  "trades",
  "winRate",
  "pnl",
  "profitFactor",
  "maxDrawdown",
  "equity",
  "demo",
  "demoTrades",
  "demoWinRate",
  "demoPnl",
  "demoProfitFactor",
  "demoMaxDrawdown",
  "demoEquity",
] as const;
export const SORT_DIRS = ["asc", "desc"] as const;

export type MarketFilter = (typeof MARKET_FILTERS)[number];
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = (typeof SORT_DIRS)[number];

const parsers = {
  market: parseAsStringLiteral(MARKET_FILTERS).withDefault("all"),
  sort: parseAsStringLiteral(SORT_KEYS).withDefault("id"),
  dir: parseAsStringLiteral(SORT_DIRS).withDefault("asc"),
};

/** Фильтр по рынку и сортировка таблицы /experiments — в URL. */
export function useExperimentsView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
