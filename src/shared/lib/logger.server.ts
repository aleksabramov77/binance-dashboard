// Серверный журнал: короткая строка в консоль, записи info+ — пачками в приёмник (БД, см.
// src/app/server/logs.ts, подключается в instrumentation.ts), локально ещё JSON-строки в
// data/logs/app-YYYY-MM-DD.jsonl (с debug). Только для сервера. Секреты маскируются по имени поля.
import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// На serverless (Vercel) каталог проекта только для чтения — пишем во временный каталог экземпляра.
export const LOG_DIR =
  process.env.LOG_DIR ??
  (process.env.VERCEL === "1"
    ? path.join(tmpdir(), "logs")
    : path.join(process.cwd(), "data", "logs"));

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

/** Приёмник записей (БД). Ошибки приёмника не должны ронять запрос — их глотает flushLogs. */
export type LogSink = (entries: LogEntry[]) => Promise<void>;

const SINK_BATCH = 50;
const SINK_DELAY_MS = 2000;
let sink: LogSink | null = null;
let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function setLogSink(next: LogSink | null): void {
  sink = next;
}

/** Отправить накопленное в приёмник. На serverless вызывается после ответа (route.server.ts). */
export function flushLogs(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!sink || buffer.length === 0) return Promise.resolve();
  const batch = buffer;
  buffer = [];
  return sink(batch).catch((error) => {
    console.error(
      `[log] ✖ log.sink: журнал не записан (${batch.length}) — ${error instanceof Error ? error.message : error}`,
    );
  });
}

function toSink(entry: LogEntry): void {
  if (!sink || LEVEL_RANK[entry.level] < LEVEL_RANK.info) return;
  buffer.push(entry);
  if (buffer.length >= SINK_BATCH) {
    void flushLogs();
    return;
  }
  flushTimer ??= setTimeout(() => void flushLogs(), SINK_DELAY_MS);
  flushTimer.unref?.();
}

function write(entry: LogEntry): void {
  // Юнит-тесты не пишут в журнал приложения.
  if (process.env.VITEST) return;
  const icon = { debug: "·", info: "•", warn: "▲", error: "✖" }[entry.level];
  const line = `[log] ${icon} ${entry.event}: ${entry.message}${entry.error ? ` — ${entry.error.message}` : ""}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else if (entry.level === "info") console.log(line);

  toSink(entry);
  // На Vercel файловый журнал бесполезен (временный каталог экземпляра) — только БД.
  if (process.env.VERCEL === "1") return;
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

export const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

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
