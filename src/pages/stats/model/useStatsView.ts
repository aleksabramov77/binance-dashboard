"use client";

import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { STATS_GROUP_BY, STATS_PERIODS } from "@/entities/experiment";

export const MARKET_FILTERS = ["spot", "futures"] as const;
export const DIRECTION_FILTERS = ["long", "short"] as const;
export const GROUP_SORT_KEYS = [
  "key",
  "trades",
  "winRate",
  "pnl",
  "fees",
  "profitFactor",
  "avgR",
  "maxDrawdown",
] as const;
export const SORT_DIRS = ["asc", "desc"] as const;

export type GroupSortKey = (typeof GROUP_SORT_KEYS)[number];
export type SortDir = (typeof SORT_DIRS)[number];

// Фильтр без значения в URL — «все»; эпоха без значения — текущая.
const parsers = {
  groupBy: parseAsStringLiteral(STATS_GROUP_BY).withDefault("experiment"),
  market: parseAsStringLiteral(MARKET_FILTERS),
  experiment: parseAsString,
  direction: parseAsStringLiteral(DIRECTION_FILTERS),
  symbol: parseAsString,
  period: parseAsStringLiteral(STATS_PERIODS).withDefault("epoch"),
  run: parseAsInteger,
  sort: parseAsStringLiteral(GROUP_SORT_KEYS).withDefault("pnl"),
  dir: parseAsStringLiteral(SORT_DIRS).withDefault("desc"),
};

/** Разрез, фильтры и сортировка /stats — в URL. */
export function useStatsView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
