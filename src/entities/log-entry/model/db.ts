// Таблицы платформы: журнал приложения и состояние алертов монитора. Раньше журнал писался в
// data/logs/*.jsonl, но на Vercel постоянного диска нет. drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Запись журнала (info и выше; debug — только в консоль и локальный файл). */
export const appLogsTable = pgTable(
  "app_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true, mode: "string" }).notNull(),
    level: text("level").notNull(),
    event: text("event").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<Record<string, unknown>>(),
    /** Где записано: vercel | vm | local. */
    source: text("source").notNull(),
  },
  (t) => [
    index("app_logs_ts_idx").on(t.ts),
    index("app_logs_level_ts_idx").on(t.level, t.ts),
  ],
);

/** Алерт монитора: активен ли, когда впервые замечен и когда последний раз отправлен. */
export const alertStateTable = pgTable("alert_state", {
  key: text("key").primaryKey(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  firstSeen: timestamp("first_seen", {
    withTimezone: true,
    mode: "string",
  }).notNull(),
  lastSeen: timestamp("last_seen", {
    withTimezone: true,
    mode: "string",
  }).notNull(),
  lastSent: timestamp("last_sent", { withTimezone: true, mode: "string" }),
});
