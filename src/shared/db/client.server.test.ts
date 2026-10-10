import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "./client.server";

describe("createMemoryDb", () => {
  it("поднимает PGlite в памяти и применяет миграции", async () => {
    const { db, close } = await createMemoryDb();
    const applied = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    // PGlite отдаёт { rows }; общий тип Db результат не уточняет.
    expect((applied as { rows: unknown[] }).rows[0]).toMatchObject({ n: 1 });
    await close();
  });
});
