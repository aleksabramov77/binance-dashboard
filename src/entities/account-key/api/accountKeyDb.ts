import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { accountKeysTable } from "../model/db";

// Чтение и запись зашифрованного ключа (только сервер: вызывает композиция src/app/server/accountKey.ts). Запросы
// синхронные (better-sqlite3): ключ нужен синхронно в загрузчиках портфеля и Earn.

type Db = BaseSQLiteDatabase<"sync", unknown>;

export type AccountKeyRow = typeof accountKeysTable.$inferSelect;

export function loadAccountKeyRow(db: Db, name: string): AccountKeyRow | null {
  return (
    db
      .select()
      .from(accountKeysTable)
      .where(eq(accountKeysTable.name, name))
      .get() ?? null
  );
}

/** Upsert: «Заменить ключ» перезаписывает ту же запись. */
export function saveAccountKeyRow(db: Db, row: AccountKeyRow): void {
  const { name, ...values } = row;
  db.insert(accountKeysTable)
    .values(row)
    .onConflictDoUpdate({ target: accountKeysTable.name, set: values })
    .run();
}

/** Удаляет запись; возвращает удалённую (для журнала — только подсказка) или null. */
export function deleteAccountKeyRow(
  db: Db,
  name: string,
): AccountKeyRow | null {
  return (
    db
      .delete(accountKeysTable)
      .where(eq(accountKeysTable.name, name))
      .returning()
      .get() ?? null
  );
}
