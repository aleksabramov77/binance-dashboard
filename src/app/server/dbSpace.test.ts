import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryDb,
  type Db,
  migrateSqlite,
  openSqlite,
} from "@/shared/db/client.server";
import { dbWhere, getDbUsage, usageOfFiles } from "./dbSpace";

// Замер места SQLite (spec 0059): файл базы с WAL относительно свободного места на диске, таблицы — через dbstat.
describe("usageOfFiles", () => {
  it("занято — база + WAL, лимит — занято + свободное место диска", () => {
    expect(
      usageOfFiles({
        dbBytes: 6_000_000,
        walBytes: 1_000_000,
        diskFreeBytes: 33_000_000,
      }),
    ).toEqual({ usedBytes: 7_000_000, limitBytes: 40_000_000 });
  });

  it("диск заполнен — свободно 0 %, лимит равен занятому", () => {
    expect(usageOfFiles({ dbBytes: 5, walBytes: 0, diskFreeBytes: 0 })).toEqual(
      { usedBytes: 5, limitBytes: 5 },
    );
  });
});

describe("getDbUsage", () => {
  let dir: string;
  let close: () => void;
  let db: Db;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "db-space-"));
    file = path.join(dir, "app.db");
    const conn = openSqlite(file);
    migrateSqlite(conn.db);
    db = conn.db;
    close = () => conn.client.close();
  });
  afterEach(() => {
    close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("файл на диске: размер с WAL, лимит больше занятого, до трёх таблиц по убыванию", async () => {
    db.run(
      `insert into app_logs (ts, level, event, message, source) values ${Array.from({ length: 300 }, (_, i) => `(${i}, 'info', 'e', '${"x".repeat(200)}', 'local')`).join(",")}`,
    );
    const usage = await getDbUsage(db, file);
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.limitBytes).toBeGreaterThan(usage.usedBytes);
    expect(usage.tables).toHaveLength(3);
    expect(usage.tables[0]?.name).toBe("app_logs");
    const sizes = usage.tables.map((t) => t.bytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(usage.tables.every((t) => t.name && t.bytes > 0)).toBe(true);
    // Где замер (spec 0068, B8): путь к файлу базы.
    expect(usage.where?.file).toBe(path.resolve(file));
    // Служебные таблицы SQLite и журнал миграций в топ не попадают.
    expect(
      usage.tables.some(
        (t) =>
          t.name.startsWith("sqlite_") || t.name === "__drizzle_migrations",
      ),
    ).toBe(false);
  });

  it("база в памяти: страницы базы, диска нет — лимит равен занятому", async () => {
    const mem = await createMemoryDb();
    const usage = await getDbUsage(mem.db, ":memory:");
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.limitBytes).toBe(usage.usedBytes);
    expect(usage.where?.file).toBeNull();
    await mem.close();
  });
});

describe("dbWhere — где замер (spec 0068, B8)", () => {
  it("VM с именем хоста и путь к базе; локально — «локально»; в памяти — без файла", () => {
    expect(
      dbWhere("/var/lib/binance/app.db", { app: "vm", name: "apps-tokyo" }),
    ).toEqual({ host: "VM apps-tokyo", file: "/var/lib/binance/app.db" });
    expect(dbWhere(":memory:", { app: "local", name: "mac.local" })).toEqual({
      host: "локально, mac.local",
      file: null,
    });
  });
});
