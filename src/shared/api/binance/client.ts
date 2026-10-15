import { getJsonWithRetry } from "@/shared/lib/fetchRetry";
import type { Market } from "./marketApi.ts";
import {
  type EarnProduct,
  earnProductsResponseSchema,
  tickerPricesSchema,
} from "./schemas";

// Тот же публичный эндпоинт, что использует страница binance.com/earn. API-ключ не нужен.
const EARN_PRODUCTS_URL =
  "https://www.binance.com/bapi/earn/v1/friendly/finance-earn/simple/product/simpleEarnProducts";
/** Последние цены всех пар: вес 4 (спот) и 2 (фьючерсы) против 80 и 40 у ticker/24hr (spec 0014). */
const TICKER_PRICE_URL: Record<Market, string> = {
  spot: "https://api.binance.com/api/v3/ticker/price",
  futures: "https://fapi.binance.com/fapi/v1/ticker/price",
};
const PAGE_SIZE = 500;

const getJson = (url: string) => getJsonWithRetry(url, "Binance");

/** Все продукты Simple Earn (Flexible + Locked). */
export async function fetchEarnProducts(): Promise<EarnProduct[]> {
  const products: EarnProduct[] = [];
  for (let page = 1; ; page++) {
    const raw = await getJson(
      `${EARN_PRODUCTS_URL}?pageIndex=${page}&pageSize=${PAGE_SIZE}`,
    );
    const { code, data } = earnProductsResponseSchema.parse(raw);
    if (code !== "000000") throw new Error(`Binance вернул код ошибки ${code}`);
    products.push(...data.list);
    if (data.list.length === 0 || products.length >= data.total)
      return products;
  }
}

/** Карта symbol → последняя цена для всех пар рынка (по умолчанию спот). */
export async function fetchTickerPrices(
  market: Market = "spot",
): Promise<Map<string, number>> {
  const tickers = tickerPricesSchema.parse(
    await getJson(TICKER_PRICE_URL[market]),
  );
  return new Map(tickers.map((t) => [t.symbol, t.price]));
}
