"use client";

import { createParser, useQueryStates } from "nuqs";
import { MARKETS, parseMarketParam } from "@/entities/experiment";

export const MARKET_FILTERS = ["all", ...MARKETS] as const;

export type MarketFilter = (typeof MARKET_FILTERS)[number];

/** Группа активов из URL; старые ссылки ?market=futures — USDⓈ-M (spec 0023). */
const marketFilter = createParser<MarketFilter>({
  parse: (v) => (v === "all" ? "all" : parseMarketParam(v)),
  serialize: (v) => v,
});

const parsers = {
  market: marketFilter.withDefault("all"),
};

/** Фильтр по группе активов /experiments — в URL; сортировка таблицы — в localStorage (spec 009). */
export function useExperimentsView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
