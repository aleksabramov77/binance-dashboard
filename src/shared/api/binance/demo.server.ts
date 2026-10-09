// Торговля в Binance Demo Trading: только для сервера (секрет API).
export {
  type DemoFill,
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPosition,
  demoFuturesPrepare,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  fetchDemoFills,
  fetchDemoOpenSymbols,
  fetchDemoPrice,
  fetchDemoSymbolRules,
  fetchDemoTradedSymbols,
  fetchDemoUsdtBalances,
  type SymbolRules,
} from "./demoTrading";
export { BinanceApiError, ResponseFormatError } from "./signed";
