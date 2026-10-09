// Серверный журнал: JSON-строки в data/logs/app-YYYY-MM-DD.jsonl + короткая строка в консоль.
// Только для сервера (node:fs). Секреты маскируются по имени поля.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  /** Короткое имя события: "binance.request", "trade.step", "http"… */
  event: string;
  message: string;
  data?: Record<string, unknown>;
  error?: { name: string; message: string; code?: unknown; stack?: string };
}

export const LOG_DIR =
  process.env.LOG_DIR ?? path.join(process.cwd(), "data", "logs");

const SECRET_KEY = /key|secret|signature|token|authorization|password/i;

/** Маскирует секреты в данных и в query-строках URL. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[…]";
  if (typeof value === "string") {
    return value.replace(
      /([?&](?:signature|apiKey|api_key|key|token)=)[^&\s]+/gi,
      "$1***",
    );
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? "***" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

function serializeError(error: unknown): LogEntry["error"] {
  if (!(error instanceof Error))
    return { name: "Unknown", message: String(error) };
  const cause = error.cause as { code?: unknown; message?: string } | undefined;
  return {
    name: error.name,
    message: cause?.message
      ? `${error.message} (${cause.message})`
      : error.message,
    code: (error as { code?: unknown }).code ?? cause?.code,
    stack: error.stack?.split("\n").slice(0, 6).join("\n"),
  };
}

export const logFileFor = (date: Date) =>
  path.join(LOG_DIR, `app-${date.toISOString().slice(0, 10)}.jsonl`);

let dirReady: Promise<unknown> | null = null;

function write(entry: LogEntry): void {
  // Юнит-тесты не пишут в журнал приложения.
  if (process.env.VITEST) return;
  const icon = { debug: "·", info: "•", warn: "▲", error: "✖" }[entry.level];
  const line = `[log] ${icon} ${entry.event}: ${entry.message}${entry.error ? ` — ${entry.error.message}` : ""}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else if (entry.level === "info") console.log(line);

  dirReady ??= mkdir(LOG_DIR, { recursive: true });
  // Журнал никогда не должен ронять запрос.
  void dirReady
    .then(() =>
      appendFile(logFileFor(new Date(entry.ts)), `${JSON.stringify(entry)}\n`),
    )
    .catch(() => {});
}

function emit(
  level: LogLevel,
  event: string,
  message: string,
  data?: Record<string, unknown>,
  error?: unknown,
) {
  write({
    ts: new Date().toISOString(),
    level,
    event,
    message,
    data: data ? (redact(data) as Record<string, unknown>) : undefined,
    error: error === undefined ? undefined : serializeError(error),
  });
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Последние записи за сегодня и вчера, новые сверху; minLevel отсекает менее важные. */
export async function readRecentLogs(
  minLevel: LogLevel = "info",
  limit = 300,
): Promise<LogEntry[]> {
  const now = new Date();
  const days = [new Date(now.getTime() - 86_400_000), now];
  const lines: string[] = [];
  for (const day of days) {
    try {
      lines.push(...(await readFile(logFileFor(day), "utf8")).split("\n"));
    } catch {
      // файла за день может не быть
    }
  }
  const entries: LogEntry[] = [];
  for (const line of lines.reverse()) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (LEVEL_RANK[entry.level] >= LEVEL_RANK[minLevel]) entries.push(entry);
    } catch {
      // битая строка (например, оборванная запись) — пропускаем
    }
    if (entries.length >= limit) break;
  }
  return entries;
}

export const log = {
  debug: (event: string, message: string, data?: Record<string, unknown>) =>
    emit("debug", event, message, data),
  info: (event: string, message: string, data?: Record<string, unknown>) =>
    emit("info", event, message, data),
  warn: (
    event: string,
    message: string,
    data?: Record<string, unknown>,
    error?: unknown,
  ) => emit("warn", event, message, data, error),
  error: (
    event: string,
    message: string,
    data?: Record<string, unknown>,
    error?: unknown,
  ) => emit("error", event, message, data, error),
};
