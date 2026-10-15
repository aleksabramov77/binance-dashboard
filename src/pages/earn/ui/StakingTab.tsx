"use client";

import { AdvancedSection } from "./AdvancedSection";

const KINDS = [
  "onchain",
  "eth-staking",
  "sol-staking",
  "rwusd",
  "bfusd",
] as const;

export function StakingTab() {
  return (
    <AdvancedSection kinds={KINDS}>
      {(catalog) => <p>Продуктов: {catalog.yields.length}</p>}
    </AdvancedSection>
  );
}
