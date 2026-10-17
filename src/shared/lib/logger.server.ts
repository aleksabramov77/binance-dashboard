// Серверный журнал: короткая строка в консоль, записи info+ — пачками в приёмник (БД, см.
// src/app/server/logs.ts, подключается в instrumentation.ts), локально ещё JSON-строки в
// data/logs/app-YYYY-MM-DD.jsonl (с debug). Только для сервера. Секреты маскируются по имени поля.
// log.notify — запись и уведомление одним вызовом (spec 0067): каналы подключаются так же, как приёмник.
import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type ChannelDelivery,
  type Notification,
  type NotifyChannel,
  type NotifyInput,
  type NotifyRecord,
  summarizeNotify,
} from "@/shared/notify";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  /** Короткое имя события: "binance.request", "trade.step", "http"… */
  event: string;
  message: string;
  data?: Record<string, unknown>;
  error?: { name: string; message: string; code?: unknown; stack?: string };
  /** Уведомление этой записи (log.notify): категория, срочность и итог доставки по каналам. */
  notify?: NotifyRecord;
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

// Приёмник и буфер — в globalThis: instrumentation.ts и роуты Next собираются разными бандлами, у каждого
// свой экземпляр этого модуля; приёмник, подключённый в instrumentation, иначе не видят роуты.
interface SinkState {
  sink: LogSink | null;
  buffer: LogEntry[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Писать ли локальный файл data/logs; false — только консоль (воркер реального счёта, spec 0047). */
  files: boolean;
  /** Каналы уведомлений log.notify (spec 0067); пусто — итог «канал не подключён». */
  channels: NotifyChannel[];
}
const sinkKey = Symbol.for("binance-dashboard.logSink");
const g = globalThis as typeof globalThis & { [sinkKey]?: SinkState };
const state = (): SinkState => {
  g[sinkKey] ??= {
    sink: null,
    buffer: [],
    timer: null,
    files: true,
    channels: [],
  };
  // Состояние могла создать прежняя версия модуля (горячая перезагрузка dev-сервера) — без каналов.
  g[sinkKey].channels ??= [];
  return g[sinkKey];
};

export function setLogSink(next: LogSink | null): void {
  state().sink = next;
}

/**
 * Каналы уведомлений (spec 0067): подключаются при старте — instrumentation.ts (сервер) и скрипты, которые
 * уведомляют, — как приёмник журнала. Второй канал — ещё один элемент списка, места вызова не меняются.
 */
export function setNotifyChannels(channels: readonly NotifyChannel[]): void {
  state().channels = [...channels];
}

/**
 * Журнал только в консоль, без файлов data/logs. Воркер реального счёта (scripts/live-worker.ts) пишет журнал
 * в stdout/stderr (journald на VM) и не трогает диск; приёмник БД у него не подключён.
 */
export function disableLogFiles(): void {
  state().files = false;
}

/** Отправить накопленное в приёмник. На serverless вызывается после ответа (route.server.ts). */
export function flushLogs(): Promise<void> {
  const st = state();
  if (st.timer) clearTimeout(st.timer);
  st.timer = null;
  const sink = st.sink;
  if (!sink || st.buffer.length === 0) return Promise.resolve();
  const batch = st.buffer;
  st.buffer = [];
  return sink(batch).catch((error) => {
    console.error(
      `[log] ✖ log.sink: журнал не записан (${batch.length}) — ${error instanceof Error ? error.message : error}`,
    );
  });
}

function toSink(entry: LogEntry): void {
  const st = state();
  if (!st.sink || LEVEL_RANK[entry.level] < LEVEL_RANK.info) return;
  st.buffer.push(entry);
  if (st.buffer.length >= SINK_BATCH) {
    void flushLogs();
    return;
  }
  st.timer ??= setTimeout(() => void flushLogs(), SINK_DELAY_MS);
  st.timer.unref?.();
}

/** Хвост строки консоли: что стало с уведомлением записи. */
const notifySuffix = (n: NotifyRecord | undefined) =>
  n
    ? ` [уведомление ${n.category}: ${n.status}${n.reason ? ` — ${n.reason}` : ""}]`
    : "";

function write(entry: LogEntry): void {
  // Юнит-тесты не пишут в журнал приложения.
  if (process.env.VITEST) return;
  const icon = { debug: "·", info: "•", warn: "▲", error: "✖" }[entry.level];
  const line = `[log] ${icon} ${entry.event}: ${entry.message}${entry.error ? ` — ${entry.error.message}` : ""}${notifySuffix(entry.notify)}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else if (entry.level === "info") console.log(line);

  toSink(entry);
  // На Vercel файловый журнал бесполезен (временный каталог экземпляра) — только БД.
  if (process.env.VERCEL === "1" || !state().files) return;
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
  notify?: NotifyRecord,
) {
  write({
    ts: new Date().toISOString(),
    level,
    event,
    message,
    data: data ? (redact(data) as Record<string, unknown>) : undefined,
    error: error === undefined ? undefined : serializeError(error),
    ...(notify && { notify }),
  });
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Каждому каналу — своё уведомление; исключение канала — итог failed, остальные каналы не ждут его. */
function deliverAll(
  n: Notification,
  channels: readonly NotifyChannel[],
): Promise<ChannelDelivery[]> {
  return Promise.all(
    channels.map(async (channel): Promise<ChannelDelivery> => {
      try {
        return { channel: channel.name, ...(await channel.deliver(n)) };
      } catch (error) {
        return {
          channel: channel.name,
          status: "failed",
          reason: errorText(error),
        };
      }
    }),
  );
}

/**
 * Уведомление и запись одним вызовом (spec 0067): запись — после доставки, итог (поле notify) в ней и в ответе.
 * Сбой канала — ещё warn notify.failed, доставка не туда, куда просили (тема не найдена), — warn notify.fallback.
 * Не бросает: уведомление не должно ронять сценарий.
 */
async function notify(input: NotifyInput): Promise<NotifyRecord> {
  const urgent = input.urgent ?? false;
  const n: Notification = {
    category: input.category,
    urgent,
    text: input.text ?? input.message,
    link: input.link ?? null,
    level: input.level,
    event: input.event,
    fixture: input.fixture ?? false,
    test: input.test ?? false,
  };
  const deliveries =
    input.skip === undefined ? await deliverAll(n, state().channels) : [];
  const record = summarizeNotify(
    { category: input.category, urgent, skip: input.skip },
    deliveries,
  );
  emit(
    input.level,
    input.event,
    input.message,
    input.data,
    input.error,
    record,
  );
  for (const d of deliveries) {
    const where = {
      event: input.event,
      category: input.category,
      channel: d.channel,
    };
    if (d.status === "failed")
      emit(
        "warn",
        "notify.failed",
        `Уведомление ${input.event} не доставлено (${d.channel}): ${d.reason ?? "без причины"}`,
        where,
      );
    else if (d.note)
      emit(
        "warn",
        "notify.fallback",
        `Уведомление ${input.event} (${d.channel}): ${d.note}`,
        where,
      );
  }
  return record;
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
  /**
   * Запись журнала и уведомление (spec 0067): `await log.notify({ level, event, message, data?, error?, category,
   * urgent?, text?, link? })`. Место вызова называет категорию и срочность, а не канал; итог доставки — в поле notify
   * записи и в ответе (sent / failed / skipped с причиной).
   */
  notify: (input: NotifyInput): Promise<NotifyRecord> => notify(input),
};
