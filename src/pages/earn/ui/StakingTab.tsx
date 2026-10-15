"use client";

import { AmountField, useOfferFilters } from "@/features/offer-filters";
import { YieldProductsTable } from "@/widgets/yield-products-table";
import { AdvancedSection } from "./AdvancedSection";

const KINDS = [
  "onchain",
  "eth-staking",
  "sol-staking",
  "rwusd",
  "bfusd",
] as const;

export function StakingTab() {
  const [{ amount }] = useOfferFilters();
  return (
    <AdvancedSection kinds={KINDS}>
      {(catalog) => (
        <div className="flex flex-col gap-6">
          <AmountField />
          <YieldProductsTable products={catalog.yields} amountUsd={amount} />
          <p className="text-xs text-muted-foreground">
            ETH/SOL Staking, RWUSD и BFUSD — ставка за последний день из истории
            Binance. On-chain Yields отправляют деньги во внешние
            DeFi-протоколы: самый высокий риск в Earn. Soft Staking — награды за
            монеты на спотовом счёте.
          </p>
        </div>
      )}
    </AdvancedSection>
  );
}
