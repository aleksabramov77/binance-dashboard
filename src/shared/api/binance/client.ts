import { getJsonWithRetry } from "@/shared/lib/fetchRetry";
import {
  type EarnProduct,
  earnProductsResponseSchema,
  tickerPricesSchema,
} from "./schemas";

// Тот же публичный эндпоинт, что использует страница binance.com/earn. API-ключ не нужен.
const EARN_PRODUCTS_URL =
  "https://www.binance.com/bapi/earn/v1/friendly/finance-earn/simple/product/simpleEarnProducts";
const TICKER_PRICE_URL = "https://api.binance.com/api/v3/ticker/price";
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

/** Карта symbol → цена для всех спотовых пар. */
export async function fetchTickerPrices(): Promise<Map<string, number>> {
  const tickers = tickerPricesSchema.parse(await getJson(TICKER_PRICE_URL));
  return new Map(tickers.map((t) => [t.symbol, t.price]));
}
