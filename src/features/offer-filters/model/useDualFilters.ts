"use client";

import {
  parseAsFloat,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { amountParser } from "./parsers";

export const DUAL_SIDE_FILTERS = ["all", "buy-low", "sell-high"] as const;
export type DualSideFilter = (typeof DUAL_SIDE_FILTERS)[number];

export const dualFilterParsers = {
  amount: amountParser,
  /** Монета (BTC…); пусто — все. */
  dcoin: parseAsString.withDefault(""),
  side: parseAsStringLiteral(DUAL_SIDE_FILTERS).withDefault("all"),
  /** Не дольше N дней; 0 — без ограничения. */
  maxDays: parseAsInteger.withDefault(30),
  /** Целевая цена не ближе N % к текущей. */
  minDist: parseAsFloat.withDefault(0),
};

export function useDualFilters() {
  return useQueryStates(dualFilterParsers, { clearOnDefault: true });
}

export type DualFilters = ReturnType<typeof useDualFilters>[0];
