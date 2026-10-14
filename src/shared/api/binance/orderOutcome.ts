import { BinanceApiError } from "./signed";

/**
 * Коды Binance, при которых исход заявки неизвестен — она могла исполниться
 * (developers.binance.com, Spot и USDⓈ-M Futures, «Error codes», проверено 2026-10-15):
 * -1006 UNEXPECTED_RESP «…Execution status unknown»,
 * -1007 TIMEOUT «…Send status unknown; execution status unknown».
 */
export const UNKNOWN_OUTCOME_CODES: readonly number[] = [-1006, -1007];

/**
 * Чем считать ошибку отправки ордера: `rejected` — биржа точно отказала, ордера нет;
 * `unknown` — ордер мог дойти и исполниться, проверить на бирже.
 * HTTP 5xx — тоже `unknown`: «NOT treat this as a failure operation; the execution status is
 * UNKNOWN» (Spot, «HTTP Return Codes»). У фьючерсов часть 503 («Service Unavailable») — отказ,
 * но по тексту их не различаем: лишняя проверка безопаснее ложного «отклонено».
 * Обрыв сети и нераспознанный ответ 2xx (`NetworkError`, `ResponseFormatError`) — `unknown`.
 */
export function orderErrorOutcome(error: unknown): "rejected" | "unknown" {
  if (!(error instanceof BinanceApiError)) return "unknown";
  if (error.code !== undefined && UNKNOWN_OUTCOME_CODES.includes(error.code))
    return "unknown";
  return error.status >= 500 ? "unknown" : "rejected";
}
