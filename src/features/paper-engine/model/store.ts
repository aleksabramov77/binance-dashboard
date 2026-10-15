import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
// Модуль среды-независимый (Node на VM и Deno в Edge Function Supabase): без @/…, node:*, env и таймеров.

/** Кто исполняет тики: VM Oracle (in-process таймер) или Edge Function Supabase. */
export const RUNNERS = ["oracle", "supabase"] as const;
export type EngineRunner = (typeof RUNNERS)[number];
export const DEFAULT_RUNNER: EngineRunner = "oracle";

/** Ключи engine_state, которые знает движок. */
export const ENGINE_KEYS = {
  /** Чей тик работает: oracle | supabase. Не задан — DEFAULT_RUNNER (план A, spec 007b). */
  runner: "runner",
  /** Тумблер «Автоторговля»; по умолчанию выключен. */
  enabled: "enabled",
  /** Последняя обработанная закрытая свеча TF по каждому эксперименту: { [id]: openTime }. */
  bars: "bars",
  /** Итог последнего тика (время, счётчики, ошибки) — для UI и журнала. */
  lastTick: "last_tick",
  /** Стартовый бюджет на эксперимент для следующей эпохи (/settings); применяется при сбросе. */
  nextBudget: "next_budget",
} as const;

/** Поля сделки, которые меняет проход выходов (трейлинг, безубыток, проверенные минуты). */
export type TradeProgress = Pick<
  PaperTrade,
  "stop" | "extreme" | "checkedUntil"
>;

/** Поля закрытия сделки. */
export type TradeClose = Pick<
  PaperTrade,
  "closedAt" | "exitPrice" | "exitReason" | "fees" | "pnl" | "rMultiple"
> & { closedAt: string };

/**
 * Хранилище лаборатории. Реализации: in-memory (тесты, Edge без БД) и Drizzle (задача 2b).
 * Движок работает только через этот интерфейс — так тик одинаков на VM и в Supabase.
 */
export interface ExperimentStore {
  /**
   * Эксперименты; строку, не прошедшую схему конфига, реализация пропускает и сообщает в onInvalid
   * (id и пути полей) — одна битая строка не останавливает тик остальных.
   */
  listExperiments(
    onInvalid?: (row: { id: string; problem: string }) => void,
  ): Promise<Experiment[]>;
  /** Текущая эпоха учёта (runs.id с наибольшим id). */
  currentRunId(): Promise<number>;
  /** Открытые сделки эпохи. */
  openTrades(runId: number): Promise<PaperTrade[]>;
  /** Реализованный PnL закрытых сделок эпохи по экспериментам (после комиссий). */
  realizedPnl(runId: number): Promise<Record<string, number>>;
  /** Вставка новой сделки; сделка с тем же id уже есть — ничего не делает (идемпотентность тика). */
  insertTrade(trade: PaperTrade): Promise<void>;
  updateTrade(id: string, progress: TradeProgress): Promise<void>;
  closeTrade(id: string, close: TradeClose): Promise<void>;
  /** Значение ключа engine_state; undefined — ключа нет. Форму проверяет вызывающий (Zod). */
  getState(key: string): Promise<unknown>;
  setState(key: string, value: unknown): Promise<void>;
}
