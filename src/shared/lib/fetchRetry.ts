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
  for (const delay of [0, ...delays]) {
    if (delay) await sleep(delay);
    try {
      return await run();
    } catch (error) {
      // HTTP-ошибки с ответом сервера не повторяем — повтор их не исправит.
      if (error instanceof HttpError) throw error;
      lastError = error;
    }
  }
  throw new NetworkError(
    `${label}: сеть не ответила — ${describeNetworkError(lastError)}`,
  );
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
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      throw new HttpError(`${label}: ответ ${res.status}`, res.status, body);
    }
    return res.json();
  });
}
