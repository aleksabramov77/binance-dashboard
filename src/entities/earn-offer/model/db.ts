// Таблица домена Earn: снимки предложений Simple Earn (раньше — файлы data/snapshots/*.json; на Vercel
// постоянного диска нет). Без связей с таблицами других доменов (docs/ai/architecture.md → «Домены и
// изоляция»). drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { isoTimestamp } from "@/shared/db/columns";
import type { Offer } from "./schema";

/** Снимок: момент загрузки и все предложения на этот момент. */
export const earnSnapshotsTable = sqliteTable("earn_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fetchedAt: isoTimestamp("fetched_at").notNull().unique(),
  offers: text("offers", { mode: "json" }).$type<Offer[]>().notNull(),
});
