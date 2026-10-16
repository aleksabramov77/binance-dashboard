// Общий кэш последних цен Binance (`ticker/price`) на процесс: шапка опрашивает раз в 30 с с каждой вкладки, а бюджеты
// лаборатории и оценка Demo в $ (spec 0038) берут одни и те же цены — второй запрос к api.binance.com не нужен
// (лимит веса на IP, spec 0014). Только сервер.
import type { BinanceMarket } from "@/shared/api/binance";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";

export const PRICES_TTL_MS = 20_000;

type PriceCache = Map<
  BinanceMarket,
  { at: number; prices: Map<string, number> }
>;
const key = Symbol.for("binance-dashboard.experimentBudgetPrices");
const g = globalThis as typeof globalThis & { [key]?: PriceCache };

/** Последние цены рынка; свежие (моложе 20 с) — из кэша, без похода на биржу. Ошибка не кэшируется. */
export async function cachedTickerPrices(
  market: BinanceMarket,
): Promise<Map<string, number>> {
  g[key] ??= new Map();
  const cached = g[key].get(market);
  if (cached && Date.now() - cached.at < PRICES_TTL_MS) return cached.prices;
  const prices = await fetchTickerPrices(market);
  g[key].set(market, { at: Date.now(), prices });
  return prices;
}

/** Для тестов: сбросить кэш процесса. */
export function clearTickerPricesCache() {
  delete g[key];
}
