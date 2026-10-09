"use client";

import {
  parseAsBoolean,
  parseAsFloat,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";

export const OFFER_TYPES = ["all", "flexible", "locked"] as const;
export type OfferTypeFilter = (typeof OFFER_TYPES)[number];

export const offerFilterParsers = {
  amount: parseAsFloat.withDefault(1000),
  q: parseAsString.withDefault(""),
  type: parseAsStringLiteral(OFFER_TYPES).withDefault("all"),
  stable: parseAsBoolean.withDefault(true),
  hideSoldOut: parseAsBoolean.withDefault(true),
};

export function useOfferFilters() {
  return useQueryStates(offerFilterParsers, { clearOnDefault: true });
}

export type OfferFilters = ReturnType<typeof useOfferFilters>[0];
