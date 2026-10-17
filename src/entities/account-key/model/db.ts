// Таблица ключей аккаунтов (spec 0065): секрет в базе только зашифрованным (AES-256-GCM, мастер-ключ — файл на
// сервере, не в базе и не в бэкапах). drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accountKeysTable = sqliteTable("account_keys", {
  /** Имя записи — оно же AAD шифрования; пока только "binance-main". */
  name: text("name").primaryKey(),
  /** JSON { apiKey, apiSecret }, зашифрованный; base64. */
  ciphertext: text("ciphertext").notNull(),
  /** IV GCM (12 байт), новый на каждое сохранение; base64. */
  iv: text("iv").notNull(),
  /** Тег GCM; base64. */
  tag: text("tag").notNull(),
  /** Последние 4 символа API Key — для карточки и журнала. */
  keyHint: text("key_hint").notNull(),
  /** Права ключа на момент проверки (флаги apiRestrictions). */
  restrictions: text("restrictions", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  savedAt: integer("saved_at", { mode: "timestamp_ms" }).notNull(),
});
