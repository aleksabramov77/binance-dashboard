"use client";

import { createParser, useQueryStates } from "nuqs";
import {
  MARKETS,
  parseMarketParam,
  parseRunParam,
  type RunParam,
} from "@/entities/experiment";

export const MARKET_FILTERS = ["all", ...MARKETS] as const;

export type MarketFilter = (typeof MARKET_FILTERS)[number];

/** Группа активов из URL; старые ссылки ?market=futures — USDⓈ-M (spec 0023). */
const marketFilter = createParser<MarketFilter>({
  parse: (v) => (v === "all" ? "all" : parseMarketParam(v)),
  serialize: (v) => v,
});

/** Период (spec 0046): номер эпохи или all; без параметра — текущая эпоха. */
const runParam = createParser<RunParam>({
  parse: parseRunParam,
  serialize: String,
});

const parsers = {
  market: marketFilter.withDefault("all"),
  run: runParam,
};

/** Фильтр по группе активов и период /experiments — в URL; сортировка таблицы — в localStorage (spec 009). */
export function useExperimentsView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
