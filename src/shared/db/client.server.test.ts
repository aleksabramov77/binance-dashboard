import { readdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "./client.server";

describe("createMemoryDb", () => {
  it("поднимает PGlite в памяти и применяет миграции", async () => {
    const { db, close } = await createMemoryDb();
    const applied = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    // Применены все миграции из drizzle/. PGlite отдаёт { rows }; общий тип Db результат не уточняет.
    const files = readdirSync(path.join(process.cwd(), "drizzle")).filter((f) =>
      f.endsWith(".sql"),
    );
    expect((applied as { rows: unknown[] }).rows[0]).toMatchObject({
      n: files.length,
    });
    await close();
  });
});
