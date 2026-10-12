// Торговля в Binance Demo Trading: только для сервера (секрет API).

export type {
  DemoCloseKind,
  DemoProtectiveStop,
  DemoSymbolOrders,
} from "./demoOrders";
export {
  type DemoFill,
  type DemoPosition,
  type DemoTradeSnapshot,
  demoCancelAllOrders,
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPosition,
  demoFuturesPrepare,
  demoFuturesReduceMarket,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  fetchDemoFills,
  fetchDemoFuturesPositions,
  fetchDemoOpenSymbols,
  fetchDemoPrice,
  fetchDemoSpotHoldings,
  fetchDemoSymbolOrders,
  fetchDemoSymbolRules,
  fetchDemoTradedSymbols,
  fetchDemoUsdtBalances,
  type SymbolRules,
} from "./demoTrading";
export { BinanceApiError, ResponseFormatError } from "./signed";
