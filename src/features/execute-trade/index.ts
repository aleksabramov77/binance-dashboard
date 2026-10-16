// Серверный слайс: подписывает ордера секретом демо-ключа. Не импортировать из клиентских компонентов.

export { SPOT_ENTRY_SLIPPAGE } from "./config/spot";
export { algoTriggered } from "./lib/closePlan";
// Площадка сделки (spec 0049): демо по умолчанию; реальный счёт передаёт воркер. Объём реального входа на $10.
export { type EntrySize, sizeEntry } from "./lib/sizeEntry";
export { tradeClientIds } from "./lib/spotEntry";
export {
  type CloseDemoRequest,
  type CloseDemoResult,
  closeDemoPosition,
} from "./model/closeDemoPosition";
export { getTradeHistory } from "./model/getTradeHistory";
export { getTradeOverview } from "./model/getTradeOverview";
export { placeTrade } from "./model/placeTrade";
export {
  type OpenMirrorLegs,
  type SweptMirror,
  sweepTriggeredLegs,
} from "./model/sweepTriggeredLegs";
export {
  demoTradeContext,
  type TradeVenueContext,
} from "./model/tradeVenue";
