import type { Setup } from "@/entities/market-signal";

export interface AutoSizeRules {
  riskPct: number;
  maxNotionalUsd: number;
  leverage: number;
}

/** Не занимать весь кошелёк одной сделкой: комиссия и движение цены до исполнения. */
const WALLET_SHARE = 0.95;

/**
 * Объём автосделки: стоп стоит riskPct баланса кошелька, объём ≤ maxNotionalUsd и
 * помещается в кошелёк (spot — весь объём, futures — маржа). null — входить не на что.
 */
export function sizeAutoTrade(
  setup: Pick<Setup, "entry" | "stopLoss" | "market">,
  walletUsd: number,
  rules: AutoSizeRules,
): { quantity: number; leverage: number } | null {
  const riskPerUnit = Math.abs(setup.entry - setup.stopLoss);
  if (riskPerUnit <= 0 || setup.entry <= 0 || walletUsd <= 0) return null;
  const leverage = setup.market === "futures" ? rules.leverage : 1;
  const maxNotional = Math.min(
    rules.maxNotionalUsd,
    walletUsd * WALLET_SHARE * leverage,
  );
  const quantity = Math.min(
    (walletUsd * rules.riskPct) / riskPerUnit,
    maxNotional / setup.entry,
  );
  return { quantity, leverage };
}
