// Торговля в Binance Demo Trading: только для сервера (секрет API).

export type {
  SpotEntryClientIds,
  SpotEntryListParams,
  SpotEntryListResult,
} from "./demoOrderLists";
export type {
  DemoCloseKind,
  DemoProtectiveStop,
  DemoSymbolOrders,
} from "./demoOrders";
export type { PriceBand, SymbolRules } from "./demoRules";
export type { SpotOrderQuery } from "./demoSchemas";
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
  demoSpotBuyProtected,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  fetchDemoFills,
  fetchDemoFuturesPositions,
  fetchDemoOpenSymbols,
  fetchDemoPrice,
  fetchDemoSpotHoldings,
  fetchDemoSpotOrderByClientId,
  fetchDemoSpotOrderStatus,
  fetchDemoSymbolOrders,
  fetchDemoSymbolRules,
  fetchDemoTradedSymbols,
  fetchDemoUsdtBalances,
} from "./demoTrading";
export { orderErrorOutcome, UNKNOWN_OUTCOME_CODES } from "./orderOutcome";
export { BinanceApiError, ResponseFormatError } from "./signed";
