import { count, desc } from "drizzle-orm";
import {
  earnSnapshotsTable,
  type Snapshot,
  snapshotSchema,
} from "@/entities/earn-offer";
import { type Db, getDb } from "@/shared/db/client.server";

/** Сохраняет снимок; повтор с тем же fetchedAt ничего не дублирует. */
export async function saveSnapshot(
  snapshot: Snapshot,
  db: Db = getDb(),
): Promise<void> {
  await db
    .insert(earnSnapshotsTable)
    .values({ fetchedAt: snapshot.fetchedAt, offers: snapshot.offers })
    .onConflictDoNothing({ target: earnSnapshotsTable.fetchedAt });
}

/** Последние limit снимков, от старых к новым. */
export async function listRecentSnapshots(
  limit: number,
  db: Db = getDb(),
): Promise<Snapshot[]> {
  const rows = await db
    .select({
      fetchedAt: earnSnapshotsTable.fetchedAt,
      offers: earnSnapshotsTable.offers,
    })
    .from(earnSnapshotsTable)
    .orderBy(desc(earnSnapshotsTable.fetchedAt))
    .limit(limit);
  return rows.reverse().map((row) =>
    snapshotSchema.parse({
      fetchedAt: new Date(row.fetchedAt).toISOString(),
      offers: row.offers,
    }),
  );
}

export async function countSnapshots(db: Db = getDb()): Promise<number> {
  const [row] = await db.select({ n: count() }).from(earnSnapshotsTable);
  return row?.n ?? 0;
}
