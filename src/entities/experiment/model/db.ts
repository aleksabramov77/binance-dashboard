// Таблицы домена «Лаборатория экспериментов» (spec 003). Без внешних ключей и джойнов в таблицы
// других доменов (docs/ai/architecture.md → «Домены и изоляция»). drizzle-kit собирает схемы
// из src/entities/*/model/db.ts. Подключение и миграции — доменно-нейтральный shared/db.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ExperimentConfig } from "./schema.ts";

type Json = Record<string, unknown>;

/**
 * Время в базе — целое число миллисекунд UTC (`mode: "timestamp_ms"`, в коде — Date). Значение по умолчанию —
 * текущее время SQLite с миллисекундами (как время по умолчанию в Postgres до spec 0059).
 */
const NOW_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/** Эксперимент: суть (гипотеза), конфигурация входа/выхода и стартовый бюджет. */
export const experimentsTable = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  market: text("market").notNull(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  config: text("config", { mode: "json" }).$type<ExperimentConfig>().notNull(),
  initialBudget: real("initial_budget").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  demoMirror: integer("demo_mirror", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * Положение переключателя демо-зеркала (spec 0043): `auto` — demo_mirror ставит авто-зеркало по paper-сделкам,
   * `on` / `off` — ручное решение пользователя, автомат его не меняет (только подсказывает).
   */
  demoMirrorMode: text("demo_mirror_mode")
    .$type<"auto" | "on" | "off">()
    .notNull()
    .default("auto"),
  /** Последнее изменение demo_mirror — начало окна сделок авто-зеркала; null — не менялось с миграции. */
  demoMirrorSince: integer("demo_mirror_since", { mode: "timestamp_ms" }),
  /** Последняя отправленная подсказка по ручному положению: что сделал бы автомат (`on` / `off`); null — нет. */
  demoMirrorAdvice: text("demo_mirror_advice").$type<"on" | "off">(),
  /** Последнее решение авто-зеркала для подсказки в UI (mirrorAutoSnapshotSchema); null — ещё не решал. */
  demoMirrorAuto: text("demo_mirror_auto", { mode: "json" }).$type<Json>(),
  /**
   * Отдельный сброс paper-капитала эксперимента: в учёт эпохи идут только его сделки, открытые
   * не раньше этого момента. null — не сбрасывался (весь учёт эпохи).
   */
  resetAt: integer("reset_at", { mode: "timestamp_ms" }),
  /**
   * Реальное зеркало (spec 0049): эксперимент повторяет свежие paper-входы на торговом субсчёте Binance через
   * воркер. Только ручное «Вкл / Выкл» с подтверждением; выключение не закрывает открытые реальные позиции.
   */
  liveMirror: integer("live_mirror", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Когда «Реальный счёт» последний раз включали или выключали. */
  liveMirrorSince: integer("live_mirror_since", { mode: "timestamp_ms" }),
  /** Кто переключил (логин GitHub; локально — «local»; автомат — «автомат»). */
  liveMirrorBy: text("live_mirror_by"),
  /**
   * Положение переключателя «Реальный счёт» (spec 0053): `off`, `auto` (live_mirror ставит автомат по демо и порогам),
   * `on` (ручное, автомат только подсказывает), `on_autooff` (ручное, выключается по порогам). Флаг live_mirror
   * по-прежнему читают воркер и захват.
   */
  liveMirrorMode: text("live_mirror_mode")
    .$type<"off" | "auto" | "on" | "on_autooff">()
    .notNull()
    .default("off"),
  /** Порог автовыключения: убыток эксперимента с момента включения (live_mirror_since), $. */
  liveLossLimitUsd: real("live_loss_limit_usd").notNull().default(15),
  /** Порог автовыключения: убыточных реальных сделок подряд. */
  liveLossStreak: integer("live_loss_streak").notNull().default(5),
  /** Последнее автовыключение: когда и почему (пометка у «Выкл»); ручное переключение очищает. */
  liveAutoOffAt: integer("live_auto_off_at", { mode: "timestamp_ms" }),
  liveAutoOffReason: text("live_auto_off_reason"),
  /** Последняя подсказка ручному «Вкл» (`loss` / `streak`) — без повторов, пока условие держится; null — нет. */
  liveMirrorAdvice: text("live_mirror_advice").$type<"loss" | "streak">(),
  /** Последняя проверка «Авто» (liveAutoSnapshotSchema); null — ещё не проверял. */
  liveMirrorAuto: text("live_mirror_auto", { mode: "json" }).$type<Json>(),
  /** Сброс демо-статистики эксперимента: в учёт идут зеркала, созданные не раньше. */
  demoResetAt: integer("demo_reset_at", { mode: "timestamp_ms" }),
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
  disabledAt: integer("disabled_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(NOW_MS),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(NOW_MS),
});

/** Эпоха учёта: «Сбросить тестовые капиталы» начинает новую; текущая — с наибольшим id. */
export const runsTable = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .notNull()
    .default(NOW_MS),
  note: text("note"),
});

/** Paper-сделка эксперимента. Открыта, пока closed_at = null. */
export const paperTradesTable = sqliteTable(
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
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    entryPrice: real("entry_price").notNull(),
    quantity: real("quantity").notNull(),
    initialStop: real("initial_stop"),
    stop: real("stop"),
    takeProfit: real("take_profit"),
    atr: real("atr").notNull(),
    extreme: real("extreme").notNull(),
    /** До какой минуты (openTime 1m-свечи, мс) выходы уже проверены. */
    checkedUntil: integer("checked_until").notNull(),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    exitPrice: real("exit_price"),
    exitReason: text("exit_reason"),
    fees: real("fees").notNull().default(0),
    pnl: real("pnl"),
    rMultiple: real("r_multiple"),
    demoOrderRef: text("demo_order_ref"),
    signal: text("signal", { mode: "json" })
      .$type<Json>()
      .notNull()
      .default({}),
    /** Худшая цена с входа (MAE, spec 0030); null — сделка до неё. */
    mae: real("mae"),
    /** Снимок рынка на входе (entryContextSchema, spec 0030); `{}` — сделка до неё. */
    entryContext: text("entry_context", { mode: "json" })
      .$type<Json>()
      .notNull()
      .default({}),
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
export const skippedSignalsTable = sqliteTable(
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
    bar: integer("bar").notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    reason: text("reason").notNull(),
    entryPrice: real("entry_price").notNull(),
    stop: real("stop"),
    takeProfit: real("take_profit"),
  },
  (t) => [
    index("skipped_signals_run_experiment_idx").on(t.runId, t.experimentId),
    // Срок хранения: движок удаляет записи старше N дней по at — без индекса это полный проход таблицы.
    index("skipped_signals_at_idx").on(t.at),
  ],
);

/** Состояние движка: включён ли, последний тик, ошибки — ключ → значение. */
export const engineStateTable = sqliteTable("engine_state", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(NOW_MS),
});

/**
 * Зеркало paper-сделки в Binance Demo (spec 008). Одна строка на сделку: вставка — «захват» сделки
 * зеркалом (повторный прогон её не тронет), дальше — статус входа и закрытия на демо-счёте.
 * Отдельная таблица, чтобы движок (Edge Function) и paper_trades не менялись.
 */
export const demoMirrorOrdersTable = sqliteTable(
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
    entryPrice: real("entry_price"),
    quantity: real("quantity"),
    /** Цена выхода на демо, если позицию закрыло зеркало по рынку; TP/SL биржи — null. */
    exitPrice: real("exit_price"),
    message: text("message").notNull().default(""),
    steps: text("steps", { mode: "json" })
      .$type<unknown[]>()
      .notNull()
      .default([]),
    /**
     * Свои защитные ордера на демо (algoId стопа/тейка, clientOrderId спота) — spec 0012, PR 2b.
     * Читать через mirrorProtectRefsSchema. null — строки до PR 2b: закрытие снимает все ордера символа.
     */
    protectRefs: text("protect_refs", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(NOW_MS),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(NOW_MS),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("demo_mirror_orders_status_idx").on(t.status)],
);

/**
 * Реальные сделки зеркала на торговом субсчёте (spec 0049) — по образцу demo_mirror_orders. Статусы те же
 * (MIRROR_STATUSES). Одна активная позиция на монету рынка — уникальный индекс по (market, symbol) среди
 * активных строк: второй захват той же монеты не пройдёт даже при двух воркерах.
 */
export const liveMirrorOrdersTable = sqliteTable(
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
    entryPrice: real("entry_price"),
    quantity: real("quantity"),
    /** Объём входа в $ (цена входа × количество). */
    notionalUsd: real("notional_usd"),
    /** Цена своего стопа при входе — худший случай для оценки PnL, если цена выхода неизвестна; null — не известна. */
    stopLoss: real("stop_loss"),
    exitPrice: real("exit_price"),
    /** Комиссии по исполнениям, $; null — не посчитаны. */
    feesUsd: real("fees_usd"),
    /** Реализованный PnL по исполнениям, $ (после комиссий в USDT); null — не посчитан. */
    realizedPnl: real("realized_pnl"),
    /** PnL — оценка по ценам входа и выхода (исполнения не прочитаны), а не по исполнениям. */
    pnlEstimated: integer("pnl_estimated", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Чем закрыта: tp | sl | mirror (с paper-сделкой) | close_all (аварийный стоп). */
    closedBy: text("closed_by"),
    /**
     * Позиция была без защиты (вход без стопа, сработавшая до входа нога, снятые при неудачном закрытии TP/SL,
     * найденный на бирже «потерянный» вход без стопа): повторная неудача закрытия не понижает «без защиты» до close_failed.
     */
    noProtection: integer("no_protection", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Неудачных попыток закрытия подряд: Telegram — на первой, итог «закрыто после N попыток» — один раз. */
    closeAttempts: integer("close_attempts").notNull().default(0),
    /** Нераспроданный остаток монеты после выхода (спот: комиссия в монете и шаг) — в PnL не входит. */
    leftoverQty: real("leftover_qty"),
    /** Остаток в $ по цене выхода. */
    leftoverUsd: real("leftover_usd"),
    message: text("message").notNull().default(""),
    steps: text("steps", { mode: "json" })
      .$type<unknown[]>()
      .notNull()
      .default([]),
    /** Свои защитные ордера (как protect_refs демо-зеркала). */
    protectRefs: text("protect_refs", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(NOW_MS),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(NOW_MS),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
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
