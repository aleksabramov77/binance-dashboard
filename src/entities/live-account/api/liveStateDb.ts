import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { liveWorkerStateTable } from "../model/db";
import { type LiveState, liveStateSchema } from "../model/heartbeat";

// Чтение и запись последнего пульса (только сервер: вызывает композиция src/app/server/liveAccount.ts).

type Db = BaseSQLiteDatabase<"sync", unknown>;

const ID = "main";

/** Последний пульс и состояние; null — воркер ещё ни разу не присылал пульс (или строка не распознана). */
export async function loadLiveState(db: Db): Promise<LiveState | null> {
  const [row] = await db
    .select()
    .from(liveWorkerStateTable)
    .where(eq(liveWorkerStateTable.id, ID));
  if (!row) return null;
  const parsed = liveStateSchema.safeParse({
    heartbeat: row.heartbeat,
    receivedAt: row.receivedAt.toISOString(),
    status: row.status,
    statusSince: row.statusSince.toISOString(),
    silentSince: row.silentSince?.toISOString() ?? null,
  });
  // Строка старого формата — как «пульса нет»: следующий пульс её перезапишет.
  return parsed.success ? parsed.data : null;
}

/** Upsert единственной строки. */
export async function saveLiveState(db: Db, state: LiveState): Promise<void> {
  const values = {
    heartbeat: state.heartbeat,
    receivedAt: new Date(state.receivedAt),
    status: state.status,
    statusSince: new Date(state.statusSince),
    silentSince: state.silentSince ? new Date(state.silentSince) : null,
  };
  await db
    .insert(liveWorkerStateTable)
    .values({ id: ID, ...values })
    .onConflictDoUpdate({ target: liveWorkerStateTable.id, set: values });
}
