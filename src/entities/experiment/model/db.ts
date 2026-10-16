// Таблицы домена «Лаборатория экспериментов» (spec 003). Без внешних ключей и джойнов в таблицы
// других доменов (docs/ai/architecture.md → «Домены и изоляция»). drizzle-kit собирает схемы
// из src/entities/*/model/db.ts. Подключение и миграции — доменно-нейтральный shared/db.
import { sql } from "drizzle-orm";
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
  uniqueIndex,
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
   * Положение переключателя демо-зеркала (spec 0043): `auto` — demo_mirror ставит авто-зеркало по paper-сделкам,
   * `on` / `off` — ручное решение пользователя, автомат его не меняет (только подсказывает).
   */
  demoMirrorMode: text("demo_mirror_mode")
    .$type<"auto" | "on" | "off">()
    .notNull()
    .default("auto"),
  /** Последнее изменение demo_mirror — начало окна сделок авто-зеркала; null — не менялось с миграции. */
  demoMirrorSince: timestamp("demo_mirror_since", { withTimezone: true }),
  /** Последняя отправленная подсказка по ручному положению: что сделал бы автомат (`on` / `off`); null — нет. */
  demoMirrorAdvice: text("demo_mirror_advice").$type<"on" | "off">(),
  /** Последнее решение авто-зеркала для подсказки в UI (mirrorAutoSnapshotSchema); null — ещё не решал. */
  demoMirrorAuto: jsonb("demo_mirror_auto").$type<Json>(),
  /**
   * Отдельный сброс paper-капитала эксперимента: в учёт эпохи идут только его сделки, открытые
   * не раньше этого момента. null — не сбрасывался (весь учёт эпохи).
   */
  resetAt: timestamp("reset_at", { withTimezone: true }),
  /**
   * Реальное зеркало (spec 0049): эксперимент повторяет свежие paper-входы на торговом субсчёте Binance через
   * воркер. Только ручное «Вкл / Выкл» с подтверждением; выключение не закрывает открытые реальные позиции.
   */
  liveMirror: boolean("live_mirror").notNull().default(false),
  /** Когда «Реальный счёт» последний раз включали или выключали. */
  liveMirrorSince: timestamp("live_mirror_since", { withTimezone: true }),
  /** Кто переключил (логин GitHub; локально — «local»). */
  liveMirrorBy: text("live_mirror_by"),
  /** Сброс демо-статистики эксперимента: в учёт идут зеркала, созданные не раньше. */
  demoResetAt: timestamp("demo_reset_at", { withTimezone: true }),
  /**
   * Вариант (spec 0046): id контрольного эксперимента, один уровень. Без внешнего ключа: сид каталога и
   * `pnpm lab:private` пишут строки в любом порядке, связь проверяет lab:private. null — не вариант.
   */
  parentId: text("parent_id"),
  /** Что изменено в варианте относительно контрольного — текст для людей. */
  variantNote: text("variant_note"),
  /**
   * Последнее выключение (spec 0046): категория (DISABLE_REASONS), короткий текст и когда. Включение очищает.
   * null у выключенного — строка до spec 0046 (без причины).
   */
  disabledReason: text("disabled_reason"),
  disabledNote: text("disabled_note"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
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
    // Срок хранения: движок удаляет записи старше N дней по at — без индекса это полный проход таблицы.
    index("skipped_signals_at_idx").on(t.at),
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

/**
 * Реальные сделки зеркала на торговом субсчёте (spec 0049) — по образцу demo_mirror_orders. Статусы те же
 * (MIRROR_STATUSES). Одна активная позиция на монету рынка — уникальный индекс по (market, symbol) среди
 * активных строк: второй захват той же монеты не пройдёт даже при двух воркерах.
 */
export const liveMirrorOrdersTable = pgTable(
  "live_mirror_orders",
  {
    tradeId: text("trade_id")
      .primaryKey()
      .references(() => paperTradesTable.id),
    experimentId: text("experiment_id").notNull(),
    market: text("market").notNull(),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),
    /** pending → protected | unprotected | rejected | skipped; затем closing → closed | close_failed. */
    status: text("status").notNull(),
    /** id попытки входа (TradeResult.id) — в журнале воркера. */
    liveRef: text("live_ref"),
    entryPrice: doublePrecision("entry_price"),
    quantity: doublePrecision("quantity"),
    /** Объём входа в $ (цена входа × количество). */
    notionalUsd: doublePrecision("notional_usd"),
    exitPrice: doublePrecision("exit_price"),
    /** Комиссии по исполнениям, $; null — не посчитаны. */
    feesUsd: doublePrecision("fees_usd"),
    /** Реализованный PnL по исполнениям, $ (после комиссий в USDT); null — не посчитан. */
    realizedPnl: doublePrecision("realized_pnl"),
    /** PnL — оценка по ценам входа и выхода (исполнения не прочитаны), а не по исполнениям. */
    pnlEstimated: boolean("pnl_estimated").notNull().default(false),
    /** Чем закрыта: tp | sl | mirror (с paper-сделкой) | close_all (аварийный стоп). */
    closedBy: text("closed_by"),
    /**
     * Позиция была без защиты (вход без стопа, сработавшая до входа нога, снятые при неудачном закрытии TP/SL,
     * найденный на бирже «потерянный» вход без стопа): повторная неудача закрытия не понижает «без защиты» до close_failed.
     */
    noProtection: boolean("no_protection").notNull().default(false),
    /** Неудачных попыток закрытия подряд: Telegram — на первой, итог «закрыто после N попыток» — один раз. */
    closeAttempts: integer("close_attempts").notNull().default(0),
    /** Нераспроданный остаток монеты после выхода (спот: комиссия в монете и шаг) — в PnL не входит. */
    leftoverQty: doublePrecision("leftover_qty"),
    /** Остаток в $ по цене выхода. */
    leftoverUsd: doublePrecision("leftover_usd"),
    message: text("message").notNull().default(""),
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    /** Свои защитные ордера (как protect_refs демо-зеркала). */
    protectRefs: jsonb("protect_refs"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("live_mirror_orders_status_idx").on(t.status),
    index("live_mirror_orders_experiment_closed_idx").on(
      t.experimentId,
      t.closedAt,
    ),
    uniqueIndex("live_mirror_orders_active_coin_uq")
      .on(t.market, t.symbol)
      .where(
        sql`${t.status} in ('pending', 'protected', 'unprotected', 'closing', 'close_failed')`,
      ),
  ],
);

export type ExperimentRow = typeof experimentsTable.$inferSelect;
export type NewExperimentRow = typeof experimentsTable.$inferInsert;
export type RunRow = typeof runsTable.$inferSelect;
export type PaperTradeRow = typeof paperTradesTable.$inferSelect;
export type NewPaperTradeRow = typeof paperTradesTable.$inferInsert;
export type DemoMirrorOrderRow = typeof demoMirrorOrdersTable.$inferSelect;
export type LiveMirrorOrderRow = typeof liveMirrorOrdersTable.$inferSelect;
export type SkippedSignalRow = typeof skippedSignalsTable.$inferSelect;
