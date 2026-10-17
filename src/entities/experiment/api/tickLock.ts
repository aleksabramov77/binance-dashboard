import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { type LockedResult, tryWithProcessLock } from "./processLock.ts";

// Блокировка тика движка (spec 007b, spec 0059): таймер процесса, POST /api/cron/tick и сбросы капиталов не
// должны работать с таблицами лаборатории одновременно. База — файл SQLite одного процесса, поэтому блокировка —
// в памяти процесса. Без @/… и node:* (её грузит и Edge Function Supabase, Deno).

/** Любая БД Drizzle на SQLite с синхронным драйвером (better-sqlite3) — приложение, скрипты, тесты. */
export type ExperimentDb = BaseSQLiteDatabase<"sync", unknown>;

export type { LockedResult };

/**
 * Ключ advisory lock движка в Postgres — только для `pnpm engine:supabase` (переключение раннера в Supabase,
 * пока Supabase не отключён). Приложение его не использует.
 */
export const ENGINE_TICK_LOCK_KEY = 3_007_007;

const ENGINE_TICK_LOCK = "engine-tick";

/**
 * Выполняет fn под блокировкой тика. Занята (тик или сброс уже идёт в этом процессе) — fn не вызывается
 * (`acquired: false`), ждать не нужно: следующий тик через минуту. fn получает ту же db: транзакции SQLite
 * синхронные, а в тике есть сетевые запросы, поэтому тик целиком в одну транзакцию не завёрнут — атомарные
 * шаги (сброс эпохи, автовыключение) делают свои синхронные транзакции.
 */
export function withEngineTickLock<T>(
  db: ExperimentDb,
  fn: (tx: ExperimentDb) => Promise<T>,
): Promise<LockedResult<T>> {
  return tryWithProcessLock(ENGINE_TICK_LOCK, () => fn(db));
}
