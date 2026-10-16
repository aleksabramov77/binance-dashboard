"use client";

import {
  createParser,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import {
  type ExperimentMarket,
  MARKETS,
  parseMarketParam,
  parseRunParam,
  type RunParam,
  STATS_GROUP_BY,
  STATS_PERIODS,
} from "@/entities/experiment";

export const MARKET_FILTERS = MARKETS;
export const DIRECTION_FILTERS = ["long", "short"] as const;

// Фильтр без значения в URL — «все»; эпоха без значения — текущая, all — все эпохи (spec 0046).
const parsers = {
  groupBy: parseAsStringLiteral(STATS_GROUP_BY).withDefault("experiment"),
  // Старые ссылки ?market=futures — USDⓈ-M (spec 0023).
  market: createParser<ExperimentMarket>({
    parse: parseMarketParam,
    serialize: (v) => v,
  }),
  experiment: parseAsString,
  direction: parseAsStringLiteral(DIRECTION_FILTERS),
  symbol: parseAsString,
  period: parseAsStringLiteral(STATS_PERIODS).withDefault("epoch"),
  run: createParser<RunParam>({ parse: parseRunParam, serialize: String }),
};

/** Разрез и фильтры /stats — в URL; сортировка таблицы — в localStorage (spec 009). */
export function useStatsView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
