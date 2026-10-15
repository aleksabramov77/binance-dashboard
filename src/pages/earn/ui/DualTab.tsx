"use client";

import { AdvancedSection } from "./AdvancedSection";

const KINDS = ["dual"] as const;

export function DualTab() {
  return (
    <AdvancedSection kinds={KINDS}>
      {(catalog) => <p>Предложений Dual: {catalog.dual.length}</p>}
    </AdvancedSection>
  );
}
