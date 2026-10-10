// Журнал приложения в БД (платформа): приёмник логгера и чтение для страницы «Логи». Только сервер.
import { and, desc, gte, inArray, lt } from "drizzle-orm";
import {
  appLogsTable,
  type LogEntry,
  type LogLevel,
} from "@/entities/log-entry";
import { isServerless } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { LEVEL_RANK } from "@/shared/lib/logger.server";

/** Сколько дней хранить журнал. */
export const LOG_RETENTION_DAYS = 14;

/** Приёмник логгера: пачка записей одной вставкой. */
export async function writeLogs(entries: LogEntry[]): Promise<void> {
  const source = isServerless() ? "vercel" : "local";
  await getDb()
    .insert(appLogsTable)
    .values(
      entries.map((e) => ({
        ts: e.ts,
        level: e.level,
        event: e.event,
        message: e.message,
        data: e.data ?? null,
        error: (e.error as Record<string, unknown> | undefined) ?? null,
        source,
      })),
    );
}

const levelsFrom = (min: LogLevel) =>
  (Object.keys(LEVEL_RANK) as LogLevel[]).filter(
    (l) => LEVEL_RANK[l] >= LEVEL_RANK[min],
  );

/** Последние записи за 2 суток, новые сверху. */
export async function readLogs(
  minLevel: LogLevel,
  limit: number,
): Promise<LogEntry[]> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const rows = await getDb()
    .select()
    .from(appLogsTable)
    .where(
      and(
        gte(appLogsTable.ts, since),
        inArray(appLogsTable.level, levelsFrom(minLevel)),
      ),
    )
    .orderBy(desc(appLogsTable.ts))
    .limit(limit);
  return rows.map((r) => ({
    ts: new Date(r.ts).toISOString(),
    level: r.level as LogLevel,
    event: r.event,
    message: r.message,
    data: { ...(r.data ?? {}), source: r.source },
    error: (r.error as LogEntry["error"]) ?? undefined,
  }));
}

/** Удалить записи старше LOG_RETENTION_DAYS; вызывает монитор. Возвращает, сколько удалено. */
export async function pruneLogs(now = Date.now()): Promise<number> {
  const before = new Date(now - LOG_RETENTION_DAYS * 86_400_000).toISOString();
  const deleted = await getDb()
    .delete(appLogsTable)
    .where(lt(appLogsTable.ts, before))
    .returning({ id: appLogsTable.id });
  return deleted.length;
}
