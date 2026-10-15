// Свободное место в базе (платформа, spec 0021): замер, пороги без повторов, уведомление в Telegram.
// Вызывают POST /api/cron/log-monitor (раз в 15 минут) и команда бота /db. Только сервер.
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  DB_SPACE,
  type DbUsage,
  formatSpaceAlert,
  freePctOf,
  planSpaceAlerts,
  type SpaceAlertRow,
} from "@/features/db-space";
import { sendTelegramMessage } from "@/shared/api/telegram";
import {
  getDbSizeLimit,
  getSiteUrl,
  getTelegramConfig,
} from "@/shared/config/env.server";
import { type Db, getDb, rowsOf } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import {
  type AlertStateRow,
  loadAlertState,
  saveAlertState,
} from "./alertState";

const sizeRowSchema = z.object({ bytes: z.coerce.number() });
const tableRowSchema = z.object({
  name: z.string(),
  bytes: z.coerce.number(),
});

/** Лимит из DB_SIZE_LIMIT_MB; некорректное значение — лимит по умолчанию и предупреждение в журнале. */
function limitBytes(): number {
  const limit = getDbSizeLimit();
  if (limit.invalid)
    log.warn(
      "monitor.db_space",
      `DB_SIZE_LIMIT_MB=${limit.invalid} некорректен — используется ${limit.limitBytes / 1024 / 1024} МБ`,
    );
  return limit.limitBytes;
}

/**
 * Размер базы и самые большие таблицы. Postgres (Supabase) и PGlite — один запрос; Supabase
 * считает лимит Free по размеру базы на диске, это и есть pg_database_size. При переезде на
 * SQLite (Lightsail) меняется только эта функция.
 */
export async function getDbUsage(db: Db = getDb()): Promise<DbUsage> {
  const [size] = rowsOf<unknown>(
    await db.execute(
      sql`select pg_database_size(current_database())::bigint as bytes`,
    ),
  ).map((r) => sizeRowSchema.parse(r));
  if (!size) throw new Error("pg_database_size не вернул размер базы");
  const tables = rowsOf<unknown>(
    await db.execute(sql`
      select case when schemaname = 'public' then relname else schemaname || '.' || relname end as name,
        pg_total_relation_size(relid)::bigint as bytes
      from pg_stat_user_tables
      order by bytes desc, name
      limit ${DB_SPACE.topTables}`),
  ).map((r) => tableRowSchema.parse(r));
  return { usedBytes: size.bytes, limitBytes: limitBytes(), tables };
}

export interface DbSpaceResult {
  usedBytes: number;
  limitBytes: number;
  /** Свободно, % от лимита (2 знака). */
  freePct: number;
  /** Порог, о котором в этом прогоне сообщение (без Telegram — только отмечен), или null. */
  notified: number | null;
  /** Сообщение ушло в Telegram. */
  sent: boolean;
}

const toSpaceRow = (r: AlertStateRow): SpaceAlertRow => ({
  ...r,
  status: r.status === "sent" ? "sent" : "cleared",
});

/** Прогон проверки места: замер → какие пороги пройдены → Telegram → alert_state. */
export async function checkDbSpace(now = Date.now()): Promise<DbSpaceResult> {
  const usage = await getDbUsage();
  const freePct = freePctOf(usage);
  const previous = (await loadAlertState(DB_SPACE.keyPrefix)).map(toSpaceRow);
  const plan = planSpaceAlerts(freePct, previous, now);
  const threshold = plan.notifyThreshold;

  const telegram = getTelegramConfig();
  const chatId = telegram?.chatId;
  let sent = false;
  if (threshold !== null && telegram && chatId) {
    try {
      await sendTelegramMessage(
        telegram.token,
        chatId,
        formatSpaceAlert(threshold, usage, `${getSiteUrl()}/logs`),
      );
      sent = true;
    } catch (error) {
      // Не дошло — пройденные пороги не отмечаем, повторим в следующий прогон.
      await saveAlertState(plan.upserts.filter((r) => r.status === "cleared"));
      throw error;
    }
  }
  // Без Telegram порог всё равно отмечается (как у монитора журнала), lastSent пустой.
  await saveAlertState(
    sent
      ? plan.upserts
      : plan.upserts.map((r) =>
          r.status === "sent" ? { ...r, lastSent: null } : r,
        ),
  );

  const result: DbSpaceResult = {
    usedBytes: usage.usedBytes,
    limitBytes: usage.limitBytes,
    freePct: Math.round(freePct * 100) / 100,
    notified: threshold,
    sent,
  };
  if (threshold !== null)
    log.warn(
      "monitor.db_space",
      `Свободного места в базе ≤ ${threshold} % (${result.freePct} %), отправлено ${sent ? "да" : "нет"}`,
      { ...result },
    );
  return result;
}
