import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { liveTradingHaltTable } from "../model/db";
import type { LiveHalt } from "../model/halt";

// Состояние аварийного стопа (одна строка "main"). Только сервер: вызывает композиция src/app/server/liveMirror.ts.

type Db = PgDatabase<PgQueryResultHKT>;

const ID = "main";

const iso = (d: Date | null) => d?.toISOString() ?? null;

const resultOf = (raw: unknown): LiveHalt["closeAllResult"] => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { closed?: unknown; failed?: unknown; errors?: unknown };
  return typeof r.closed === "number" && typeof r.failed === "number"
    ? {
        closed: r.closed,
        failed: r.failed,
        errors: Array.isArray(r.errors) ? r.errors.map(String) : [],
      }
    : null;
};

/** Состояние стопа; строки ещё нет — торговля не остановлена. Сбой БД — исключение (вход не идёт). */
export async function loadLiveHalt(db: Db): Promise<LiveHalt> {
  const [row] = await db
    .select()
    .from(liveTradingHaltTable)
    .where(eq(liveTradingHaltTable.id, ID));
  return {
    stopped: row?.stopped ?? false,
    stoppedAt: iso(row?.stoppedAt ?? null),
    stoppedBy: row?.stoppedBy ?? null,
    closeAllRequestedAt: iso(row?.closeAllRequestedAt ?? null),
    closeAllRequestedBy: row?.closeAllRequestedBy ?? null,
    closeAllDoneAt: iso(row?.closeAllDoneAt ?? null),
    closeAllResult: resultOf(row?.closeAllResult),
  };
}

async function upsert(
  db: Db,
  set: Partial<typeof liveTradingHaltTable.$inferInsert>,
): Promise<void> {
  await db
    .insert(liveTradingHaltTable)
    .values({ id: ID, ...set })
    .onConflictDoUpdate({
      target: liveTradingHaltTable.id,
      set: { ...set, updatedAt: sql`now()` },
    });
}

/** «Стоп входов» (true) или «Возобновить» (false). Возобновление снимает и незавершённое «Закрыть всё» нельзя: оно остаётся. */
export function setLiveStopped(db: Db, stopped: boolean, by: string) {
  return upsert(db, { stopped, stoppedAt: new Date(), stoppedBy: by });
}

/** «Закрыть всё»: стоп входов и запрос воркеру закрыть все реальные позиции. */
export function requestLiveCloseAll(db: Db, by: string) {
  const at = new Date();
  return upsert(db, {
    stopped: true,
    stoppedAt: at,
    stoppedBy: by,
    closeAllRequestedAt: at,
    closeAllRequestedBy: by,
  });
}

/** Воркер выполнил «Закрыть всё»: запрос снят, итог сохранён. Стоп входов остаётся до «Возобновить». */
export function completeLiveCloseAll(
  db: Db,
  result: { closed: number; failed: number; errors: string[] },
) {
  return upsert(db, {
    closeAllRequestedAt: null,
    closeAllDoneAt: new Date(),
    closeAllResult: result,
  });
}
