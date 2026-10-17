// Свободное место в базе (платформа, spec 0021): замер, пороги без повторов, уведомление — категория «Сервер»
// (spec 0067). Вызывают POST /api/cron/log-monitor (раз в 15 минут) и команда бота /db. Только сервер.
import { statfsSync, statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  DB_SPACE,
  type DbTableSize,
  type DbUsage,
  type DbWhere,
  formatSpaceAlert,
  freePctOf,
  planSpaceAlerts,
  type SpaceAlertRow,
} from "@/features/db-space";
import { getAppHost, getSiteLink } from "@/shared/config/env.server";
import {
  type Db,
  getDb,
  getDbPath,
  MEMORY_PATH,
} from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import {
  type AlertStateRow,
  loadAlertState,
  saveAlertState,
} from "./alertState";

const tableRowSchema = z.object({
  name: z.string(),
  bytes: z.coerce.number(),
});

/** Файлы базы SQLite: сама база и журнал WAL (-shm — разделяемая память, место почти не занимает). */
export interface DbFiles {
  /** Размер файла базы, байт. */
  dbBytes: number;
  /** Размер -wal, байт (нет файла — 0). */
  walBytes: number;
  /** Свободно на диске, где лежит база, байт (statfs: доступно непривилегированному процессу). */
  diskFreeBytes: number;
}

/**
 * Занято и лимит (spec 0059): занято — файл базы с WAL, лимит — занято + свободное место на диске. Сколько ещё
 * может вырасти база — ровно свободное место диска VM, пороги уведомлений (spec 0021) считаются от этого.
 */
export function usageOfFiles(
  files: DbFiles,
): Pick<DbUsage, "usedBytes" | "limitBytes"> {
  const usedBytes = files.dbBytes + files.walBytes;
  return { usedBytes, limitBytes: usedBytes + files.diskFreeBytes };
}

const fileSize = (file: string) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

/** Размеры файлов базы и свободное место на её диске. База в памяти — страницы базы, диска нет. */
function readDbFiles(db: Db, file: string): DbFiles {
  if (file === MEMORY_PATH) {
    const pages = db.get<{ bytes: number }>(
      sql`select page_count * page_size as bytes from pragma_page_count(), pragma_page_size()`,
    );
    return { dbBytes: pages?.bytes ?? 0, walBytes: 0, diskFreeBytes: 0 };
  }
  const disk = statfsSync(path.dirname(path.resolve(file)));
  return {
    dbBytes: fileSize(file),
    walBytes: fileSize(`${file}-wal`),
    diskFreeBytes: disk.bavail * disk.bsize,
  };
}

/** Самые большие таблицы (с их индексами) — виртуальная таблица dbstat; нет её в сборке SQLite — пусто. */
function largestTables(db: Db): DbTableSize[] {
  try {
    return db
      .all(
        sql`select coalesce(m.tbl_name, s.name) as name, sum(s.pgsize) as bytes
          from dbstat s left join sqlite_schema m on m.name = s.name
          where coalesce(m.tbl_name, s.name) not like 'sqlite_%'
            and coalesce(m.tbl_name, s.name) <> '__drizzle_migrations'
          group by 1
          order by bytes desc, name
          limit ${DB_SPACE.topTables}`,
      )
      .map((r) => tableRowSchema.parse(r));
  } catch (error) {
    log.warn(
      "monitor.db_space",
      "Размеры таблиц не прочитаны (dbstat)",
      undefined,
      error,
    );
    return [];
  }
}

/** Где замер (spec 0068, B8): VM или Mac с именем хоста, путь к файлу базы; база в памяти — file null. */
export function dbWhere(
  file: string,
  host: { app: ReturnType<typeof getAppHost>; name: string } = {
    app: getAppHost(),
    name: hostname(),
  },
): DbWhere {
  const label = { vm: "VM", local: "локально,", vercel: "Vercel" }[host.app];
  return {
    host: `${label} ${host.name}`,
    file: file === MEMORY_PATH ? null : path.resolve(file),
  };
}

/**
 * Размер базы и самые большие таблицы (spec 0059): файл SQLite с WAL относительно свободного места на диске.
 * file — путь базы (по умолчанию — база приложения).
 */
export async function getDbUsage(
  db: Db = getDb(),
  file: string = getDbPath(),
): Promise<DbUsage> {
  // База в памяти (тесты): диска нет — лимит равен занятому.
  return {
    ...usageOfFiles(readDbFiles(db, file)),
    tables: largestTables(db),
    where: dbWhere(file),
  };
}

export interface DbSpaceResult {
  usedBytes: number;
  limitBytes: number;
  /** Свободно, % от лимита (2 знака). */
  freePct: number;
  /** Порог, о котором в этом прогоне сообщение (не отправлено — только отмечен), или null. */
  notified: number | null;
  /** Уведомление доставлено. */
  sent: boolean;
}

const toSpaceRow = (r: AlertStateRow): SpaceAlertRow => ({
  ...r,
  status: r.status === "sent" ? "sent" : "cleared",
});

/** Прогон проверки места: замер → какие пороги пройдены → запись с уведомлением → alert_state. */
export async function checkDbSpace(now = Date.now()): Promise<DbSpaceResult> {
  const usage = await getDbUsage();
  const freePct = freePctOf(usage);
  const previous = (await loadAlertState(DB_SPACE.keyPrefix)).map(toSpaceRow);
  const plan = planSpaceAlerts(freePct, previous, now);
  const threshold = plan.notifyThreshold;
  const result: DbSpaceResult = {
    usedBytes: usage.usedBytes,
    limitBytes: usage.limitBytes,
    freePct: Math.round(freePct * 100) / 100,
    notified: threshold,
    sent: false,
  };
  if (threshold === null) {
    await saveAlertState(plan.upserts);
    return result;
  }

  const notice = await log.notify({
    level: "warn",
    event: "monitor.db_space",
    message: `Свободного места в базе ≤ ${threshold} % (${result.freePct} %)`,
    data: {
      usedBytes: result.usedBytes,
      limitBytes: result.limitBytes,
      freePct: result.freePct,
      notified: threshold,
      where: usage.where,
    },
    category: "server",
    // Свободно ≤ 20 % — со звуком; 50 / 40 / 30 % — тихо.
    urgent: threshold <= DB_SPACE.urgentPct,
    text: formatSpaceAlert(threshold, usage, getSiteLink("/logs")),
  });
  result.sent = notice.status === "sent";
  if (notice.status === "failed") {
    // Не дошло — пройденные пороги не отмечаем, повторим в следующий прогон.
    await saveAlertState(plan.upserts.filter((r) => r.status === "cleared"));
    return result;
  }
  // Не отправлялось (не production, канал не настроен) — порог всё равно отмечается (как у монитора журнала),
  // lastSent пустой.
  await saveAlertState(
    result.sent
      ? plan.upserts
      : plan.upserts.map((r) =>
          r.status === "sent" ? { ...r, lastSent: null } : r,
        ),
  );
  return result;
}

/**
 * Проверка места для монитора журнала (роут /api/cron/log-monitor и таймер VM, spec 0048): сбой замера не ломает
 * монитор — ошибка в журнале и в результате.
 */
export async function checkDbSpaceSafe(): Promise<
  DbSpaceResult | { error: string }
> {
  try {
    return await checkDbSpace();
  } catch (error) {
    log.error(
      "monitor.db_space",
      "Проверка свободного места в базе не удалась",
      undefined,
      error,
    );
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
