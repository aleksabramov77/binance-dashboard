/** Отправляет ошибку из браузера в серверный журнал. Никогда не бросает исключений. */
export function reportClientError(
  source: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const err =
    error instanceof Error
      ? { message: error.message, stack: error.stack?.slice(0, 2000) }
      : { message: String(error) };
  try {
    void fetch("/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        message: err.message.slice(0, 1000),
        stack: err.stack,
        url: window.location.pathname + window.location.search,
        context,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // журнал не должен ломать интерфейс
  }
}
