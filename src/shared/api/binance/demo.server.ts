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
export { clientIdGroup } from "./demoOrders";
export type { CoinmContract, PriceBand, SymbolRules } from "./demoRules";
export type {
  AlgoOrderQuery,
  FuturesOrder,
  FuturesSymbolState,
  SpotOpenOrder,
  SpotOrderQuery,
} from "./demoSchemas";
export type { AlgoRef, ProtectMarket, PublicVenue } from "./demoTrading";
export {
  DEMO_PUBLIC_VENUE,
  type DemoFill,
  type DemoPosition,
  type DemoTradeSnapshot,
  demoCancelAlgoOrder,
  demoEnableHedgeMode,
  demoFuturesCancelOrder,
  demoFuturesMarketOrder,
  demoFuturesPositions,
  demoFuturesPrepare,
  demoFuturesProtect,
  demoFuturesReduceMarket,
  demoSpotBuyProtected,
  demoSpotCancelByClientId,
  demoSpotCancelOrder,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  enableOnewayMode,
  fetchDemoAlgoOrder,
  fetchDemoCoinmAvailable,
  fetchDemoEquity,
  fetchDemoFills,
  fetchDemoFuturesAccountBusy,
  fetchDemoFuturesOrder,
  fetchDemoFuturesPositions,
  fetchDemoFuturesSymbolState,
  fetchDemoOpenAlgoOrders,
  fetchDemoOpenSymbols,
  fetchDemoPositionMode,
  fetchDemoPrice,
  fetchDemoSpotHoldings,
  fetchDemoSpotOpenOrders,
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
export {
  entryParams,
  type FuturesSide,
  type PositionMode,
  positionSideOf,
  protectParams,
  reduceParams,
} from "./positionMode";
export { type DemoProtectRefs, demoProtectRefsSchema } from "./protectRefs";
export { BinanceApiError, ResponseFormatError } from "./signed";
