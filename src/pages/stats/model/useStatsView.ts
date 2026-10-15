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

// Фильтр без значения в URL — «все»; эпоха без значения — текущая.
const parsers = {
  groupBy: parseAsStringLiteral(STATS_GROUP_BY).withDefault("experiment"),
  market: parseAsStringLiteral(MARKET_FILTERS),
  experiment: parseAsString,
  direction: parseAsStringLiteral(DIRECTION_FILTERS),
  symbol: parseAsString,
  period: parseAsStringLiteral(STATS_PERIODS).withDefault("epoch"),
  run: parseAsInteger,
};

/** Разрез и фильтры /stats — в URL; сортировка таблицы — в localStorage (spec 009). */
export function useStatsView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
