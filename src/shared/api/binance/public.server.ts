// Публичные (без ключа) запросы к Binance: только для сервера — пишут в журнал через node:fs.
export { fetchEarnProducts, fetchTickerPrices } from "./client";
export {
  fetch24hTicker,
  fetch24hTickers,
  fetchFundingRates,
  fetchKlines,
  fetchPerpetualSymbols,
} from "./market";
