// Таблица реального счёта (spec 0047): последний пульс воркера и состояние для уведомлений (одна строка).
// drizzle-kit собирает схемы из src/entities/*/model/db.ts. Время — целые миллисекунды UTC (spec 0059).
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const liveWorkerStateTable = sqliteTable("live_worker_state", {
  /** Одна строка: "main" (воркер один). */
  id: text("id").primaryKey(),
  /** Последний пульс (liveHeartbeatSchema). */
  heartbeat: text("heartbeat", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  /** Оценка, о которой уже сообщили: ok | blocked | no-key — без повторов Telegram. */
  status: text("status").notNull(),
  statusSince: integer("status_since", { mode: "timestamp_ms" }).notNull(),
  /** Монитор записал «воркер молчит» (live.status); null — не молчит. */
  silentSince: integer("silent_since", { mode: "timestamp_ms" }),
});

/**
 * Аварийный стоп реального счёта (spec 0049, одна строка "main"): «Стоп входов» и «Закрыть всё». Воркер читает его
 * перед каждым входом; не прочитали — вход не идёт (fail-closed).
 */
export const liveTradingHaltTable = sqliteTable("live_trading_halt", {
  id: text("id").primaryKey(),
  /** Новые реальные входы остановлены (до «Возобновить»). */
  stopped: integer("stopped", { mode: "boolean" }).notNull().default(false),
  stoppedAt: integer("stopped_at", { mode: "timestamp_ms" }),
  /** Кто остановил или возобновил (логин GitHub; локально — «local»). */
  stoppedBy: text("stopped_by"),
  /** «Закрыть всё» запрошено и ещё не выполнено воркером. */
  closeAllRequestedAt: integer("close_all_requested_at", {
    mode: "timestamp_ms",
  }),
  closeAllRequestedBy: text("close_all_requested_by"),
  /** Итог последнего «Закрыть всё»: когда и сколько закрыто, ошибки. */
  closeAllDoneAt: integer("close_all_done_at", { mode: "timestamp_ms" }),
  closeAllResult: text("close_all_result", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
});
