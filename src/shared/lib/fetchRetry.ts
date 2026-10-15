// Только для сервера (пишет в журнал). Не экспортируется из клиентского @/shared/lib.
import { log } from "./logger.server";

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

// Пауза после 429/418 (spec 0014): лимит веса Binance считается на IP, а повтор во время бана удлиняет бан
// (от минут до 3 суток). Поэтому после такого ответа к тому же хосту не ходим, пока пауза не кончится. Пауза живёт
// в памяти процесса (на Vercel — экземпляра функции).

/** Запрос не отправлен: к хосту действует пауза после 429/418. */
export class CooldownError extends HttpError {}

/** Пауза, если Binance не сказал срок (ни Retry-After, ни «banned until»). */
export const DEFAULT_COOLDOWN_MS = 60_000;

const COOLDOWN_STATUSES = new Set([418, 429]);

const cooldowns = new Map<string, { until: number; status: number }>();

/** Сбросить все паузы (тесты). */
export function resetBinanceCooldowns() {
  cooldowns.clear();
}

/** Конец паузы: Retry-After (сек), для бана — «banned until <ms>» из тела, если позже; иначе 60 с. */
export function cooldownEnd(
  now: number,
  retryAfter: string | null,
  body: unknown,
): number {
  const seconds = Number(retryAfter);
  let until =
    retryAfter && Number.isFinite(seconds) && seconds > 0
      ? now + seconds * 1000
      : now + DEFAULT_COOLDOWN_MS;
  const msg = (body as { msg?: unknown } | null)?.msg;
  const banned =
    typeof msg === "string" ? /banned until (\d{13})/.exec(msg) : null;
  if (banned) until = Math.max(until, Number(banned[1]));
  return until;
}

const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/** GET JSON с повторами: и обрыв соединения, и обрыв тела (битый JSON) повторяются. */
export async function getJsonWithRetry(
  url: string,
  label: string,
): Promise<unknown> {
  const host = new URL(url).host;
  const pause = cooldowns.get(host);
  if (pause && Date.now() < pause.until)
    throw new CooldownError(
      `${label}: пауза до ${hhmmss(pause.until)} UTC после ответа ${pause.status}`,
      pause.status,
    );
  if (pause) cooldowns.delete(host);

  return withRetry(label, async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      log.warn("http.upstream", `${label}: ответ ${res.status}`, {
        url,
        status: res.status,
        body,
      });
      if (COOLDOWN_STATUSES.has(res.status)) {
        const until = cooldownEnd(
          Date.now(),
          res.headers.get("retry-after"),
          body,
        );
        // Параллельные запросы получают 429/418 почти одновременно: пауза только удлиняется (поздний 429 без
        // срока не сокращает бан), а в журнал попадает одна запись на новую или продлённую паузу.
        const current = cooldowns.get(host);
        if (!current || current.until <= Date.now() || until > current.until) {
          cooldowns.set(host, { until, status: res.status });
          log.warn(
            "binance.cooldown",
            `${label}: пауза запросов к ${host} до ${hhmmss(until)} UTC`,
            { host, status: res.status, until: new Date(until).toISOString() },
          );
        }
      }
      throw new HttpError(`${label}: ответ ${res.status}`, res.status, body);
    }
    return res.json();
  });
}
