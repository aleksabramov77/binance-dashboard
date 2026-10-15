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
export type {
  AlgoOrderQuery,
  FuturesOrder,
  SpotOrderQuery,
} from "./demoSchemas";
export {
  type DemoFill,
  type DemoPosition,
  type DemoTradeSnapshot,
  demoCancelAlgoOrder,
  demoCancelAllOrders,
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPosition,
  demoFuturesPrepare,
  demoFuturesReduceMarket,
  demoSpotBuyProtected,
  demoSpotCancelByClientId,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  fetchDemoAlgoOrder,
  fetchDemoFills,
  fetchDemoFuturesOrder,
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
export {
  nextRecheckDelay,
  ORDER_RECV_WINDOW_MS,
  orderErrorOutcome,
  UNKNOWN_OUTCOME_CODES,
  unknownOutcomeDeadline,
} from "./orderOutcome";
export { type DemoProtectRefs, demoProtectRefsSchema } from "./protectRefs";
export { BinanceApiError, ResponseFormatError } from "./signed";
