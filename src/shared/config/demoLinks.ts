import { splitSymbol } from "@/shared/lib/symbol";

/** Веб-интерфейс Binance Demo Trading (графики, ордера, позиции демо-счёта). */
const DEMO_WEB_URL = "https://demo.binance.com/en";

/** Активы демо-счёта на demo.binance.com — там кнопка «Сброс» баланса (API для сброса у Binance нет). */
export const DEMO_WALLET_URL = `${DEMO_WEB_URL}/my/wallet/demo/main`;

/** Страница пары на Binance Demo: Futures — /futures/BATUSDT, Spot — /trade/ETH_USDT?type=spot. */
export function demoChartUrl(
  market: "spot" | "futures",
  symbol: string,
): string {
  if (market === "futures") return `${DEMO_WEB_URL}/futures/${symbol}`;
  const { base, quote } = splitSymbol(symbol);
  // Неизвестная котируемая валюта — страница рынков вместо битой ссылки «ABC_».
  return quote
    ? `${DEMO_WEB_URL}/trade/${base}_${quote}?type=spot`
    : `${DEMO_WEB_URL}/markets/overview`;
}
