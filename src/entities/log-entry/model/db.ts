// Таблицы платформы: журнал приложения и состояние алертов монитора. Раньше журнал писался в
// data/logs/*.jsonl, но на Vercel постоянного диска нет. drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import {
  customType,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Момент как ISO-строка в коде и целое число миллисекунд UTC в SQLite (spec 0059): сортировка и сравнения — числом. */
const isoTimestamp = customType<{ data: string; driverData: number }>({
  dataType: () => "integer",
  toDriver: (iso) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`не дата: ${iso}`);
    return ms;
  },
  fromDriver: (ms) => new Date(ms).toISOString(),
});

/** Запись журнала (info и выше; debug — только в консоль и локальный файл). */
export const appLogsTable = sqliteTable(
  "app_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: isoTimestamp("ts").notNull(),
    level: text("level").notNull(),
    event: text("event").notNull(),
    message: text("message").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Где записано: vercel | vm | local. */
    source: text("source").notNull(),
  },
  (t) => [
    index("app_logs_ts_idx").on(t.ts),
    index("app_logs_level_ts_idx").on(t.level, t.ts),
  ],
);

/** Алерт монитора: активен ли, когда впервые замечен и когда последний раз отправлен. */
export const alertStateTable = sqliteTable("alert_state", {
  key: text("key").primaryKey(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  firstSeen: isoTimestamp("first_seen").notNull(),
  lastSeen: isoTimestamp("last_seen").notNull(),
  lastSent: isoTimestamp("last_sent"),
});
