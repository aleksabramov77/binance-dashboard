// Обёртка API-роутов: журнал каждого запроса (метод, путь, статус, время) и единая обработка
// непредвиденных ошибок — клиент всегда получает JSON { error }, а в журнале остаётся стек.
import { HttpError, NetworkError } from "./fetchRetry";
import { log } from "./logger.server";

type Handler = (request: Request) => Promise<Response>;

interface Options {
  /** Не писать успешные запросы (для частого опроса, например журнала). */
  quiet?: boolean;
}

export function withLogging(
  name: string,
  handler: Handler,
  options: Options = {},
): Handler {
  return async (request: Request) => {
    const started = Date.now();
    const { pathname } = new URL(request.url);
    const base = { route: name, method: request.method, path: pathname };
    try {
      const response = await handler(request);
      const data = {
        ...base,
        status: response.status,
        ms: Date.now() - started,
      };
      const line = `${request.method} ${pathname} → ${response.status} за ${data.ms} мс`;
      if (response.status >= 500) log.error("http", line, data);
      else if (response.status >= 400) log.warn("http", line, data);
      else if (!options.quiet) log.info("http", line, data);
      return response;
    } catch (error) {
      // Внешний сервис не ответил — это 502, всё остальное — наша ошибка (500).
      const upstream =
        error instanceof NetworkError || error instanceof HttpError;
      const status = upstream ? 502 : 500;
      log.error(
        upstream ? "http.upstream" : "http.unhandled",
        `${request.method} ${pathname} → ${status}`,
        { ...base, status, ms: Date.now() - started },
        error,
      );
      const message = error instanceof Error ? error.message : String(error);
      return Response.json(
        { error: upstream ? message : `Внутренняя ошибка: ${message}` },
        { status },
      );
    }
  };
}
