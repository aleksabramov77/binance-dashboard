// Серверный слайс: подписывает ордера секретом демо-ключа. Не импортировать из клиентских компонентов.
export {
  type CloseDemoRequest,
  type CloseDemoResult,
  closeDemoPosition,
} from "./model/closeDemoPosition";
export { getTradeHistory } from "./model/getTradeHistory";
export { getTradeOverview } from "./model/getTradeOverview";
export { placeTrade } from "./model/placeTrade";
