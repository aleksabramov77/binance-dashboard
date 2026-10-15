// Состояние уведомлений (платформа): таблица alert_state, общая для монитора журнала и порогов
// свободного места в базе. У каждой проверки свои ключи и статусы — чужие строки она не трогает.
import { like } from "drizzle-orm";
import { alertStateTable } from "@/entities/log-entry";
import { getDb } from "@/shared/db/client.server";

export interface AlertStateRow {
  key: string;
  status: string;
  title: string;
  firstSeen: string;
  lastSeen: string;
  lastSent: string | null;
}

/** Строки alert_state; с keyPrefix — только ключи с этим префиксом. */
export async function loadAlertState(
  keyPrefix?: string,
): Promise<AlertStateRow[]> {
  const query = getDb().select().from(alertStateTable);
  return keyPrefix
    ? query.where(like(alertStateTable.key, `${keyPrefix}%`))
    : query;
}

/** Upsert по ключу. */
export async function saveAlertState(rows: AlertStateRow[]): Promise<void> {
  const db = getDb();
  for (const r of rows)
    await db
      .insert(alertStateTable)
      .values(r)
      .onConflictDoUpdate({
        target: alertStateTable.key,
        set: {
          status: r.status,
          title: r.title,
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen,
          lastSent: r.lastSent,
        },
      });
}
