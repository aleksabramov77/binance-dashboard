// Таблица домена Earn: снимки предложений Simple Earn (раньше — файлы data/snapshots/*.json; на Vercel
// постоянного диска нет). Без связей с таблицами других доменов (docs/ai/architecture.md → «Домены и
// изоляция»). drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import {
  customType,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { Offer } from "./schema";

/** Момент как ISO-строка в коде и целое число миллисекунд UTC в SQLite (spec 0059): сортировка и сравнения — числом. */
const isoTimestamp = customType<{ data: string; driverData: number }>({
  dataType: () => "integer",
  toDriver: (iso) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`не дата: ${iso}`);
    return ms;
  },
  fromDriver: (ms) => new Date(ms).toISOString(),
});

/** Снимок: момент загрузки и все предложения на этот момент. */
export const earnSnapshotsTable = sqliteTable("earn_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fetchedAt: isoTimestamp("fetched_at").notNull().unique(),
  offers: text("offers", { mode: "json" }).$type<Offer[]>().notNull(),
});
