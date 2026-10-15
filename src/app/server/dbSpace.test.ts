import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { getDbUsage } from "./dbSpace";

// Замер места тем же запросом, что в Supabase: PGlite в памяти с миграциями drizzle/.
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  vi.stubEnv("DB_SIZE_LIMIT_MB", "");
  ({ db, close } = await createMemoryDb());
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

describe("getDbUsage", () => {
  it("размер базы, лимит и до трёх самых больших таблиц по убыванию", async () => {
    const usage = await getDbUsage(db);
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.limitBytes).toBe(500 * 1024 * 1024);
    expect(usage.tables).toHaveLength(3);
    const sizes = usage.tables.map((t) => t.bytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(usage.tables.every((t) => t.name && t.bytes > 0)).toBe(true);
  });
});
