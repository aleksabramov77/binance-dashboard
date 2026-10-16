// Таблица реального счёта (spec 0047): последний пульс воркера и состояние для уведомлений (одна строка).
// drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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

/**
 * Аварийный стоп реального счёта (spec 0049, одна строка "main"): «Стоп входов» и «Закрыть всё». Воркер читает его
 * перед каждым входом; не прочитали — вход не идёт (fail-closed).
 */
export const liveTradingHaltTable = pgTable("live_trading_halt", {
  id: text("id").primaryKey(),
  /** Новые реальные входы остановлены (до «Возобновить»). */
  stopped: boolean("stopped").notNull().default(false),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  /** Кто остановил или возобновил (логин GitHub; локально — «local»). */
  stoppedBy: text("stopped_by"),
  /** «Закрыть всё» запрошено и ещё не выполнено воркером. */
  closeAllRequestedAt: timestamp("close_all_requested_at", {
    withTimezone: true,
  }),
  closeAllRequestedBy: text("close_all_requested_by"),
  /** Итог последнего «Закрыть всё»: когда и сколько закрыто, ошибки. */
  closeAllDoneAt: timestamp("close_all_done_at", { withTimezone: true }),
  closeAllResult: jsonb("close_all_result").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
