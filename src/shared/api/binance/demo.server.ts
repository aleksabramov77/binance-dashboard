// Торговля в Binance Demo Trading: только для сервера (секрет API).
export {
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPrepare,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  fetchDemoPrice,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
  type SymbolRules,
} from "./demoTrading";
export { BinanceApiError } from "./signed";
