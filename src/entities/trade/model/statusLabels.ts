import type { TradeStatus } from "./schema";

/** Подписи статусов сделки — для подсказки и легенды. */
export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  open: "Открыта, стоп стоит",
  "open-trailing": "Открыта, стоп подтянут в безубыток/прибыль",
  "open-unprotected": "Открыта без стопа",
  tp: "Закрыта по TP",
  "stop-profit": "Закрыта по подтянутому стопу в плюс",
  sl: "Закрыта по SL",
  "manual-profit": "Закрыта вручную в профит",
  "manual-loss": "Закрыта вручную в лосс",
  liquidation: "Ликвидация",
  unknown: "Статус неизвестен",
};
