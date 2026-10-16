import type { BinanceMarket } from "./markets";

// Оценка кошельков Binance в $ (spec 0038): чистые функции без сети — их тестируем. Сеть — demoTrading.ts
// (`fetchDemoEquity`) и accountClient.ts (`fetchWalletBalances`).

/** Цена актива в $; null — цены нет. */
export type UsdPrice = (asset: string) => number | null;

/** Оценка кошелька: сумма в $ и активы с ненулевым остатком без цены (в сумму не вошли). */
export interface WalletEquity {
  usd: number;
  unpriced: string[];
}

/** Результат по кошельку: оценка или ошибка запроса (остальные кошельки от неё не зависят). */
export type WalletEquityResult =
  | ({ ok: true } & WalletEquity)
  | { ok: false; error: unknown };

/** Сумма остатков в $; нулевые остатки пропускаются, активы без цены — в `unpriced`. */
export function sumUsd(
  rows: readonly { asset: string; amount: number }[],
  price: UsdPrice,
): WalletEquity {
  let usd = 0;
  const unpriced: string[] = [];
  for (const { asset, amount } of rows) {
    if (amount === 0) continue;
    const p = price(asset);
    if (p === null) unpriced.push(asset);
    else usd += amount * p;
  }
  return { usd, unpriced };
}

/** Имена кошельков в `/sapi/v1/asset/wallet/balance` → рынок (проба 2026-10-16). Остальные кошельки — не рынки. */
export const WALLET_MARKET: Readonly<Record<string, BinanceMarket>> = {
  Spot: "spot",
  "USDⓈ-M Futures": "usdm",
  "COIN-M Futures": "coinm",
};

/** Остатки кошельков Spot, USDⓈ-M и COIN-M (в $ по quoteAsset USDT); кошелька нет в ответе — null. */
export function walletsByMarket(
  wallets: readonly { walletName: string; balance: number }[],
): Record<BinanceMarket, number | null> {
  const out: Record<BinanceMarket, number | null> = {
    spot: null,
    usdm: null,
    coinm: null,
  };
  for (const w of wallets) {
    const market = WALLET_MARKET[w.walletName];
    if (market) out[market] = (out[market] ?? 0) + w.balance;
  }
  return out;
}
