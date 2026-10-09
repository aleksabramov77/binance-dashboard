// Торговля в Binance Demo Trading: только для сервера (секрет API).
export {
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPosition,
  demoFuturesPrepare,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  fetchDemoPrice,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
  type SymbolRules,
} from "./demoTrading";
export { BinanceApiError, ResponseFormatError } from "./signed";
