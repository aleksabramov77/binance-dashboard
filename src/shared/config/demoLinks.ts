import { splitSymbol } from "@/shared/lib/symbol";

/** Веб-интерфейс Binance Demo Trading (графики, ордера, позиции демо-счёта). */
const DEMO_WEB_URL = "https://demo.binance.com/en";

/** Страница пары на Binance Demo: Futures — /futures/BATUSDT, Spot — /trade/ETH_USDT?type=spot. */
export function demoChartUrl(
  market: "spot" | "futures",
  symbol: string,
): string {
  if (market === "futures") return `${DEMO_WEB_URL}/futures/${symbol}`;
  const { base, quote } = splitSymbol(symbol);
  return `${DEMO_WEB_URL}/trade/${base}_${quote}?type=spot`;
}
