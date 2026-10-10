// Таблицы лаборатории экспериментов (spec 003). Слой shared не знает о сущностях, поэтому
// jsonb здесь — обобщённые записи: проверку и маппинг в типы entities/experiment делает Zod
// в репозитории сущности.
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

type Json = Record<string, unknown>;

/** Эксперимент: суть (гипотеза), конфигурация входа/выхода и стартовый бюджет. */
export const experiments = pgTable("experiments", {
  id: text("id").primaryKey(),
  market: text("market").notNull(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  config: jsonb("config").$type<Json>().notNull(),
  initialBudget: doublePrecision("initial_budget").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  demoMirror: boolean("demo_mirror").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Эпоха учёта: «Сбросить тестовые капиталы» начинает новую; текущая — с наибольшим id. */
export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  note: text("note"),
});

/** Paper-сделка эксперимента. Открыта, пока closed_at = null. */
export const paperTrades = pgTable(
  "paper_trades",
  {
    id: text("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id),
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
  },
  (t) => [
    index("paper_trades_run_experiment_idx").on(t.runId, t.experimentId),
    index("paper_trades_run_closed_idx").on(t.runId, t.closedAt),
    index("paper_trades_symbol_idx").on(t.symbol),
  ],
);

/** Состояние движка: включён ли, последний тик, ошибки — ключ → значение. */
export const engineState = pgTable("engine_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ExperimentRow = typeof experiments.$inferSelect;
export type NewExperimentRow = typeof experiments.$inferInsert;
export type RunRow = typeof runs.$inferSelect;
export type PaperTradeRow = typeof paperTrades.$inferSelect;
export type NewPaperTradeRow = typeof paperTrades.$inferInsert;
