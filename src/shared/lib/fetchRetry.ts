// Только для сервера (пишет в журнал). Не экспортируется из клиентского @/shared/lib.
import { log } from "./logger.server";

/**
 * Таймаут одного HTTP-запроса (до тела ответа включительно). Больше 10 с: за 10 с Binance сам
 * отвечает -1007 «Timeout waiting for response from backend server» — этот ответ важнее обрыва.
 * Сработал — сетевая ошибка: чтение повторяется, у ордера исход неизвестен (проверяем на бирже).
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Паузы перед повторами при сетевом сбое. */
export const RETRY_DELAYS_MS = [400, 1200, 3000] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** «fetch failed» → «fetch failed (UND_ERR_SOCKET: other side closed)». */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  const detail = [cause?.code, cause?.message].filter(Boolean).join(": ");
  return detail ? `${error.message} (${detail})` : error.message;
}

export class NetworkError extends Error {}

/**
 * Повторяет операцию при сетевом сбое или обрыве тела ответа.
 * Только для идемпотентных запросов (чтение): ордера так повторять нельзя.
 */
export async function withRetry<T>(
  label: string,
  run: () => Promise<T>,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;
  const attempts = delays.length + 1;
  for (const [i, delay] of [0, ...delays].entries()) {
    if (delay) await sleep(delay);
    try {
      const result = await run();
      if (i > 0)
        log.info("net.recovered", `${label}: успех с попытки ${i + 1}`, {
          label,
          attempt: i + 1,
        });
      return result;
    } catch (error) {
      // HTTP-ошибки с ответом сервера не повторяем — повтор их не исправит.
      if (error instanceof HttpError) throw error;
      lastError = error;
      log.warn(
        "net.retry",
        `${label}: сбой сети, попытка ${i + 1}/${attempts}`,
        { label, attempt: i + 1, attempts },
        error,
      );
    }
  }
  const failure = new NetworkError(
    `${label}: сеть не ответила — ${describeNetworkError(lastError)}`,
  );
  log.error("net.failed", failure.message, { label, attempts }, lastError);
  throw failure;
}

/** Сервер ответил, но с ошибкой (4xx/5xx). */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

/** GET JSON с повторами: и обрыв соединения, и обрыв тела (битый JSON) повторяются. */
export function getJsonWithRetry(url: string, label: string): Promise<unknown> {
  return withRetry(label, async () => {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      log.warn("http.upstream", `${label}: ответ ${res.status}`, {
        url,
        status: res.status,
        body,
      });
      throw new HttpError(`${label}: ответ ${res.status}`, res.status, body);
    }
    return res.json();
  });
}
