// Серверный слайс: фоновая автоторговля в Binance Demo. Не импортировать из клиентских компонентов.
export { AUTO_TRADE } from "./config/autoTrade";
export {
  getAutoTradeState,
  setAutoTradeEnabled,
  startAutoTrader,
} from "./model/autoTrader";
export type { AutoTradeDeps } from "./model/runCycle";
