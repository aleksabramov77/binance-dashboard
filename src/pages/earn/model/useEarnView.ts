"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";

export const EARN_TABS = ["simple", "dual", "staking", "guide"] as const;
export type EarnTab = (typeof EARN_TABS)[number];

const parsers = {
  tab: parseAsStringLiteral(EARN_TABS).withDefault("simple"),
};

/** Активная вкладка /earn — в URL (`?tab=dual`); Simple Earn — без параметра. */
export function useEarnView() {
  return useQueryStates(parsers, { clearOnDefault: true });
}
