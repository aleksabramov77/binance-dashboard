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

/**
 * recvWindow ордеров входа: биржа не передаст заявку в движок, если с её timestamp прошло больше
 * (Spot и USDⓈ-M Futures, «Timing security»: по умолчанию 5000, Spot — максимум 60000, Binance
 * советует ≤ 5000). Короткое окно ограничивает, сколько ждать при неизвестном исходе.
 */
export const ORDER_RECV_WINDOW_MS = 5000;

/** Сервер принимает timestamp до 1 с впереди своих часов — плюс запас на подпись и отправку. */
const CLOCK_MARGIN_MS = 1500;

/**
 * Минимум ожидания после ответа с неизвестным исходом. -1007 приходит через ~10 с — окно уже
 * прошло, но заявка, переданная в движок, могла исполниться чуть позже ответа.
 */
export const UNKNOWN_MIN_WAIT_MS = 3000;

/** Шаг перечитывания заявки/позиции при неизвестном исходе. */
export const UNKNOWN_RECHECK_STEP_MS = 1000;

/**
 * До какого момента (Date.now()) заявка с неизвестным исходом ещё может появиться на бирже:
 * отправка + recvWindow + запас на часы, но не раньше failedAt + UNKNOWN_MIN_WAIT_MS.
 * Вердикт «заявки/позиции нет» — только по проверке, начатой после этого момента.
 */
export function unknownOutcomeDeadline(
  sentAt: number,
  failedAt: number,
): number {
  return Math.max(
    sentAt + ORDER_RECV_WINDOW_MS + CLOCK_MARGIN_MS,
    failedAt + UNKNOWN_MIN_WAIT_MS,
  );
}

/**
 * Пауза до следующей проверки; null — последняя проверка начата уже после дедлайна, её
 * «нет» окончательное. Последняя пауза — ровно до дедлайна (+1 мс).
 */
export function nextRecheckDelay(
  now: number,
  deadline: number,
  checkStartedAt: number,
): number | null {
  if (checkStartedAt > deadline) return null;
  return Math.max(1, Math.min(UNKNOWN_RECHECK_STEP_MS, deadline - now + 1));
}
