// Таблица домена Earn: снимки предложений Simple Earn (раньше — файлы data/snapshots/*.json; на Vercel
// постоянного диска нет). Без связей с таблицами других доменов (docs/ai/architecture.md → «Домены и
// изоляция»). drizzle-kit собирает схемы из src/entities/*/model/db.ts.
import { jsonb, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import type { Offer } from "./schema";

/** Снимок: момент загрузки и все предложения на этот момент. */
export const earnSnapshotsTable = pgTable("earn_snapshots", {
  id: serial("id").primaryKey(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
    .notNull()
    .unique(),
  offers: jsonb("offers").$type<Offer[]>().notNull(),
});
