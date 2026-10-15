// Таблицы домена «Лаборатория экспериментов» (spec 003). Без внешних ключей и джойнов в таблицы
// других доменов (docs/ai/architecture.md → «Домены и изоляция»). drizzle-kit собирает схемы
// из src/entities/*/model/db.ts. Подключение и миграции — доменно-нейтральный shared/db.
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { ExperimentConfig } from "./schema.ts";

type Json = Record<string, unknown>;

/** Эксперимент: суть (гипотеза), конфигурация входа/выхода и стартовый бюджет. */
export const experimentsTable = pgTable("experiments", {
  id: text("id").primaryKey(),
  market: text("market").notNull(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  config: jsonb("config").$type<ExperimentConfig>().notNull(),
  initialBudget: doublePrecision("initial_budget").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  demoMirror: boolean("demo_mirror").notNull().default(false),
  /**
   * Отдельный сброс paper-капитала эксперимента: в учёт эпохи идут только его сделки, открытые
   * не раньше этого момента. null — не сбрасывался (весь учёт эпохи).
   */
  resetAt: timestamp("reset_at", { withTimezone: true }),
  /** Сброс демо-статистики эксперимента: в учёт идут зеркала, созданные не раньше. */
  demoResetAt: timestamp("demo_reset_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Эпоха учёта: «Сбросить тестовые капиталы» начинает новую; текущая — с наибольшим id. */
export const runsTable = pgTable("runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  note: text("note"),
});

/** Paper-сделка эксперимента. Открыта, пока closed_at = null. */
export const paperTradesTable = pgTable(
  "paper_trades",
  {
    id: text("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runsTable.id),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experimentsTable.id),
    market: text("market").notNull(),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    initialStop: doublePrecision("initial_stop"),
    stop: doublePrecision("stop"),
    takeProfit: doublePrecision("take_profit"),
    atr: doublePrecision("atr").notNull(),
    extreme: doublePrecision("extreme").notNull(),
    /** До какой минуты (openTime 1m-свечи, мс) выходы уже проверены. */
    checkedUntil: bigint("checked_until", { mode: "number" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    exitPrice: doublePrecision("exit_price"),
    exitReason: text("exit_reason"),
    fees: doublePrecision("fees").notNull().default(0),
    pnl: doublePrecision("pnl"),
    rMultiple: doublePrecision("r_multiple"),
    demoOrderRef: text("demo_order_ref"),
    signal: jsonb("signal").$type<Json>().notNull().default({}),
    /** Худшая цена с входа (MAE, spec 0030); null — сделка до неё. */
    mae: doublePrecision("mae"),
    /** Снимок рынка на входе (entryContextSchema, spec 0030); `{}` — сделка до неё. */
    entryContext: jsonb("entry_context").$type<Json>().notNull().default({}),
  },
  (t) => [
    index("paper_trades_run_experiment_idx").on(t.runId, t.experimentId),
    index("paper_trades_run_closed_idx").on(t.runId, t.closedAt),
    index("paper_trades_symbol_idx").on(t.symbol),
  ],
);

/**
 * Отсечённые сигналы (spec 0030): сигнал прошёл фильтры эксперимента, но сделку не открыли — лимит позиций,
 * символ уже в позиции, нет денег. Объём ограничен движком: не больше ENGINE.skippedSignalsCap строк на
 * (эпоха, эксперимент, причина) и хранение ENGINE.skippedSignalsRetentionDays дней (features/paper-engine).
 */
export const skippedSignalsTable = pgTable(
  "skipped_signals",
  {
    /** run-эксперимент-символ-свеча-причина: повтор тика не дублирует строку. */
    id: text("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runsTable.id),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experimentsTable.id),
    market: text("market").notNull(),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),
    /** openTime свечи сигнала ТФ эксперимента, мс. */
    bar: bigint("bar", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    stop: doublePrecision("stop"),
    takeProfit: doublePrecision("take_profit"),
  },
  (t) => [
    index("skipped_signals_run_experiment_idx").on(t.runId, t.experimentId),
  ],
);

/** Состояние движка: включён ли, последний тик, ошибки — ключ → значение. */
export const engineStateTable = pgTable("engine_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Зеркало paper-сделки в Binance Demo (spec 008). Одна строка на сделку: вставка — «захват» сделки
 * зеркалом (повторный прогон её не тронет), дальше — статус входа и закрытия на демо-счёте.
 * Отдельная таблица, чтобы движок (Edge Function) и paper_trades не менялись.
 */
export const demoMirrorOrdersTable = pgTable(
  "demo_mirror_orders",
  {
    tradeId: text("trade_id")
      .primaryKey()
      .references(() => paperTradesTable.id),
    experimentId: text("experiment_id").notNull(),
    market: text("market").notNull(),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),
    /** pending → protected | unprotected | rejected; затем closing → closed | close_failed. */
    status: text("status").notNull(),
    /** id попытки входа (TradeResult.id) — ищется в журнале по trade.done/trade.rejected. */
    demoRef: text("demo_ref"),
    entryPrice: doublePrecision("entry_price"),
    quantity: doublePrecision("quantity"),
    /** Цена выхода на демо, если позицию закрыло зеркало по рынку; TP/SL биржи — null. */
    exitPrice: doublePrecision("exit_price"),
    message: text("message").notNull().default(""),
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    /**
     * Свои защитные ордера на демо (algoId стопа/тейка, clientOrderId спота) — spec 0012, PR 2b.
     * Читать через mirrorProtectRefsSchema. null — строки до PR 2b: закрытие снимает все ордера символа.
     */
    protectRefs: jsonb("protect_refs"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("demo_mirror_orders_status_idx").on(t.status)],
);

export type ExperimentRow = typeof experimentsTable.$inferSelect;
export type NewExperimentRow = typeof experimentsTable.$inferInsert;
export type RunRow = typeof runsTable.$inferSelect;
export type PaperTradeRow = typeof paperTradesTable.$inferSelect;
export type NewPaperTradeRow = typeof paperTradesTable.$inferInsert;
export type DemoMirrorOrderRow = typeof demoMirrorOrdersTable.$inferSelect;
export type SkippedSignalRow = typeof skippedSignalsTable.$inferSelect;
