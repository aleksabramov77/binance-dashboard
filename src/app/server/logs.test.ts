import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOG_FILTERS } from "@/entities/log-entry";
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
    const all = await readLogs({ ...DEFAULT_LOG_FILTERS }, 10);
    expect(all.map((e) => e.message)).toEqual(["GET /x → 500", "GET / → 200"]);
    expect(all[0].data).toMatchObject({ path: "/x", source: "local" });
    expect(
      (await readLogs({ ...DEFAULT_LOG_FILTERS, level: "error" }, 10)).map(
        (e) => e.level,
      ),
    ).toEqual(["error"]);
  }, 30_000);

  it("фильтрует по событиям, experimentId в data и глубине в днях", async () => {
    const now = Date.now();
    await writeLogs([
      {
        ts: new Date(now - 1000).toISOString(),
        level: "warn",
        event: "mirror.rejected",
        message: "F03",
        data: { experimentId: "F03" },
      },
      {
        ts: new Date(now - 2000).toISOString(),
        level: "info",
        event: "mirror.skipped",
        message: "F03 skip",
        data: { experimentId: "F03" },
      },
      {
        ts: new Date(now - 3000).toISOString(),
        level: "info",
        event: "mirror.skipped",
        message: "S01",
        data: { experimentId: "S01" },
      },
      {
        ts: new Date(now - 5 * 86_400_000).toISOString(),
        level: "info",
        event: "mirror.skipped",
        message: "старая",
        data: { experimentId: "F03" },
      },
    ]);
    const f = {
      level: "info" as const,
      events: ["mirror.rejected", "mirror.skipped"],
      experiment: "F03",
      days: 2,
    };
    expect((await readLogs(f, 10)).map((e) => e.message)).toEqual([
      "F03",
      "F03 skip",
    ]);
    expect(
      (await readLogs({ ...f, days: 14 }, 10)).map((e) => e.message),
    ).toEqual(["F03", "F03 skip", "старая"]);
    expect(await readLogs({ ...f, experiment: "F03' OR 1=1" }, 10)).toEqual([]);
    expect(
      (await readLogs({ ...f, events: [], experiment: "" }, 10)).length,
    ).toBe(3);
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
