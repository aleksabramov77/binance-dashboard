/** Активы, которые считаем «долларовыми» (цена ≈ 1 USD). */
export const STABLECOINS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "USDP",
  "DAI",
  "BFUSD",
  "USD1",
  "RLUSD",
  "PYUSD",
  "USDE",
  "USDS",
  "XUSD",
  "U",
]);

export function isStablecoin(asset: string): boolean {
  return STABLECOINS.has(asset.toUpperCase());
}
