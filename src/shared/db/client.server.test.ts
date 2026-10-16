import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, migrateSqlite, openSqlite } from "./client.server";

const migrations = () =>
  readdirSync(path.join(process.cwd(), "drizzle")).filter((f) =>
    f.endsWith(".sql"),
  ).length;

describe("createMemoryDb", () => {
  it("поднимает SQLite в памяти и применяет все миграции drizzle/", async () => {
    const { db, close } = await createMemoryDb();
    const applied = db.get<{ n: number }>(
      "select count(*) as n from __drizzle_migrations",
    );
    expect(applied?.n).toBe(migrations());
    expect(
      db.get<{ foreign_keys: number }>("pragma foreign_keys")?.foreign_keys,
    ).toBe(1);
    await close();
  });
});

describe("openSqlite", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("файл: создаёт каталоги, WAL, ожидание блокировки и внешние ключи; повторные миграции — без изменений", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sqlite-"));
    dirs.push(dir);
    const file = path.join(dir, "nested", "app.db");
    const conn = openSqlite(file);
    expect(existsSync(file)).toBe(true);
    expect(conn.client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(conn.client.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(conn.client.pragma("foreign_keys", { simple: true })).toBe(1);
    migrateSqlite(conn.db);
    migrateSqlite(conn.db);
    expect(
      conn.db.get<{ n: number }>(
        "select count(*) as n from __drizzle_migrations",
      )?.n,
    ).toBe(migrations());
    conn.client.close();
  });
});
