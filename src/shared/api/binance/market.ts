import { getJsonWithRetry } from "@/shared/lib/fetchRetry";
import { createMarketApi } from "./marketApi.ts";

// Публичные запросы Binance для Node-сервера: повторы и журнал — getJsonWithRetry.
// Сами запросы и разбор ответов — среда-независимый marketApi.ts (его же использует Edge Function).
export type {
  BinanceMarket,
  Candle,
  FuturesMarket,
  Market,
  Perpetuals,
} from "./marketApi.ts";

export const {
  fetch24hTickers,
  fetch24hTicker,
  fetchCoinmTickers,
  fetchKlines,
  fetchPerpetuals,
  fetchPerpetualSymbols,
  fetchFundingRates,
} = createMarketApi((url) => getJsonWithRetry(url, "Binance"));
