// Композиция автоторговли: фича auto-trade получает скан, предпроверку и исполнение сделки
// из других фич здесь, в слое app (фичи друг друга не импортируют). Только сервер.
import {
  type AutoTradeDeps,
  setAutoTradeEnabled as setEnabled,
  startAutoTrader as start,
} from "@/features/auto-trade";
import { getTradeOverview, placeTrade } from "@/features/execute-trade";
import { recheckSetup, scanMarket } from "@/features/scan-market";

const deps: AutoTradeDeps = {
  scan: () => scanMarket(),
  recheck: recheckSetup,
  place: placeTrade,
  overview: getTradeOverview,
};

export const startAutoTrader = () => start(deps);
export const setAutoTradeEnabled = (enabled: boolean) =>
  setEnabled(enabled, deps);
