import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

// Межпроцессная блокировка тика движка (spec 007b): VM Oracle, Edge Function Supabase, /api/cron/tick
// и сброс эпохи не должны работать с таблицами лаборатории одновременно. Без @/… и node:* (Deno).

/** Любая БД Drizzle на Postgres: postgres.js, PGlite. */
export type ExperimentDb = PgDatabase<PgQueryResultHKT>;

/**
 * Ключ advisory lock движка лаборатории — фиксированный, общий для всех процессов и раннеров.
 * Число произвольное, лишь бы не совпадало с другими advisory lock в этой БД (других нет).
 */
export const ENGINE_TICK_LOCK_KEY = 3_007_007;

export type LockedResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

/** Строки ответа db.execute: postgres.js отдаёт массив, PGlite — { rows }. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Выполняет fn в транзакции, взяв `pg_try_advisory_xact_lock(ENGINE_TICK_LOCK_KEY)`. Блокировка занята
 * другим сеансом — fn не вызывается (`acquired: false`), ждать не нужно: следующий тик через минуту.
 * Блокировка транзакционная, поэтому работает и через Transaction pooler Supabase (порт 6543), где
 * сеансовые блокировки ненадёжны; снимается сама при COMMIT/ROLLBACK или обрыве соединения.
 * Все запросы fn — через переданный tx (на PGlite запрос к внешнему db внутри транзакции зависнет).
 */
export async function withEngineTickLock<T>(
  db: ExperimentDb,
  fn: (tx: ExperimentDb) => Promise<T>,
): Promise<LockedResult<T>> {
  return db.transaction(async (tx) => {
    const [row] = rowsOf(
      await tx.execute(
        sql`select pg_try_advisory_xact_lock(${ENGINE_TICK_LOCK_KEY}) as locked`,
      ),
    );
    if (row?.locked !== true) return { acquired: false as const };
    return { acquired: true as const, value: await fn(tx) };
  });
}
