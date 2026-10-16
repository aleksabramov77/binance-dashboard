// Таблица реального счёта (spec 0047): последний пульс воркера и состояние для уведомлений (одна строка).
// drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const liveWorkerStateTable = pgTable("live_worker_state", {
  /** Одна строка: "main" (воркер один). */
  id: text("id").primaryKey(),
  /** Последний пульс (liveHeartbeatSchema). */
  heartbeat: jsonb("heartbeat").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  /** Оценка, о которой уже сообщили: ok | blocked | no-key — без повторов Telegram. */
  status: text("status").notNull(),
  statusSince: timestamp("status_since", { withTimezone: true }).notNull(),
  /** Монитор записал «воркер молчит» (live.status); null — не молчит. */
  silentSince: timestamp("silent_since", { withTimezone: true }),
});
