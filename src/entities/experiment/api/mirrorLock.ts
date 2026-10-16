import { sql } from "drizzle-orm";
import type { ExperimentDb, LockedResult } from "./tickLock";

// Блокировка прогона demo-зеркала (spec 0012, PR 2e): бюджет прогона 200 с больше минуты крона, два
// прогона одновременно открыли бы один вход дважды или закрыли бы чужое. Без @/… и node:* (как tickLock).

/** Ключ advisory lock прогона зеркала — свой, не совпадает с ENGINE_TICK_LOCK_KEY. */
export const MIRROR_RUN_LOCK_KEY = 3_012_012;

/** Прогон в этом процессе (второй вызов того же экземпляра функции / dev-сервера). */
let runningHere = false;

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Выполняет fn, если прогон зеркала больше нигде не идёт. Не взяли — fn не вызывается
 * (`acquired: false`): следующий прогон через минуту.
 * - Postgres (holdLock): `pg_try_advisory_xact_lock` в отдельной транзакции, которая держится всё время
 *   fn; в ней же — таймаут простоя idleTimeoutS (больше maxDuration крона). Сама fn работает через обычный db (другие соединения пула): её записи не откатываются, если
 *   прогон оборвётся (ордера на бирже уже стоят), а блокировка снимается при обрыве соединения сама.
 *   Транзакционная — работает и через Transaction pooler Supabase (сеансовые там ненадёжны).
 * - PGlite (holdLock false): одно соединение — запросы fn внутри открытой транзакции зависли бы;
 *   локальная БД одного процесса, хватает блокировки в памяти процесса.
 */
export async function withMirrorRunLock<T>(
  db: ExperimentDb,
  fn: () => Promise<T>,
  holdLock: boolean,
  idleTimeoutS = 330,
): Promise<LockedResult<T>> {
  if (runningHere) return { acquired: false };
  runningHere = true;
  try {
    if (!holdLock) return { acquired: true, value: await fn() };
    return await db.transaction(async (tx) => {
      const [row] = rowsOf(
        await tx.execute(
          sql`select pg_try_advisory_xact_lock(${MIRROR_RUN_LOCK_KEY}) as locked`,
        ),
      );
      if (row?.locked !== true) return { acquired: false as const };
      // SET LOCAL idle_in_transaction_session_timeout (set_config с is_local = true принимает параметр):
      // транзакция с замком простаивает весь прогон; если экземпляр функции заморозят с открытым
      // сокетом, сервер закроет сеанс через idleTimeoutS — замок не повиснет навсегда.
      await tx.execute(
        sql`select set_config('idle_in_transaction_session_timeout', ${`${Math.round(idleTimeoutS)}s`}, true)`,
      );
      return { acquired: true as const, value: await fn() };
    });
  } finally {
    runningHere = false;
  }
}
