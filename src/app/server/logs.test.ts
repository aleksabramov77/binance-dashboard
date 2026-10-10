import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";

let memory: { db: Db; close: () => Promise<void> };
vi.mock("@/shared/db/client.server", async (orig) => ({
  ...(await orig<typeof import("@/shared/db/client.server")>()),
  getDb: () => memory.db,
}));
const { pruneLogs, readLogs, writeLogs } = await import("./logs");

describe("журнал в БД", () => {
  beforeEach(async () => {
    memory = await createMemoryDb();
  });
  afterEach(() => memory.close());

  it("пишет пачку и читает новые сверху с фильтром уровня", async () => {
    const now = Date.now();
    await writeLogs([
      {
        ts: new Date(now - 2000).toISOString(),
        level: "info",
        event: "http",
        message: "GET / → 200",
      },
      {
        ts: new Date(now - 1000).toISOString(),
        level: "error",
        event: "http",
        message: "GET /x → 500",
        data: { path: "/x" },
      },
    ]);
    const all = await readLogs("info", 10);
    expect(all.map((e) => e.message)).toEqual(["GET /x → 500", "GET / → 200"]);
    expect(all[0].data).toMatchObject({ path: "/x", source: "local" });
    expect((await readLogs("error", 10)).map((e) => e.level)).toEqual([
      "error",
    ]);
  }, 30_000);

  it("удаляет записи старше 14 дней", async () => {
    const now = Date.now();
    await writeLogs([
      {
        ts: new Date(now - 15 * 86_400_000).toISOString(),
        level: "info",
        event: "old",
        message: "старое",
      },
      {
        ts: new Date(now).toISOString(),
        level: "info",
        event: "new",
        message: "новое",
      },
    ]);
    expect(await pruneLogs(now)).toBe(1);
  }, 30_000);
});
