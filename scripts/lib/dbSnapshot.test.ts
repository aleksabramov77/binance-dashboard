import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateSqlite, openSqlite } from "@/shared/db/client.server";
import { installSnapshot } from "./dbSnapshot";

// Установка снимка `pnpm db:pull` (spec 0059): проверка до замены, без мусора рядом с итоговым файлом.
let dir: string;
let out: string;
let part: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "db-snapshot-"));
  out = path.join(dir, "prod.db");
  part = `${out}.part`;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Снимок как после `.backup` прод-базы: WAL-режим, миграции, один эксперимент. */
function writeSnapshot(file: string) {
  const conn = openSqlite(file);
  migrateSqlite(conn.db);
  conn.db.run(
    "insert into experiments (id, market, name, hypothesis, config, initial_budget) values ('S99', 'spot', 'n', 'h', '{}', 1)",
  );
  conn.client.close();
}

describe("installSnapshot", () => {
  it("исправный снимок встаёт на место прежнего; рядом нет .part, -wal и -shm", () => {
    writeFileSync(out, "старый снимок");
    writeSnapshot(part);
    expect(installSnapshot(part, out)).toEqual({ experiments: 1 });
    expect(readdirSync(dir)).toEqual(["prod.db"]);
  });

  it("ssh вернул не базу — понятная ошибка, .part с хвостами удалён, прежний снимок цел", () => {
    writeFileSync(out, "старый снимок");
    writeFileSync(part, "sudo: a password is required\n".repeat(200));
    writeFileSync(`${part}-wal`, "x");
    expect(() => installSnapshot(part, out)).toThrow(
      /не исправная база приложения \(file is not a database\); прежний .*prod\.db не тронут/,
    );
    expect(readdirSync(dir)).toEqual(["prod.db"]);
    expect(readFileSync(out, "utf8")).toBe("старый снимок");
  });

  it("база без таблиц приложения — тоже отказ", () => {
    openSqlite(part).client.close();
    expect(() => installSnapshot(part, out)).toThrow(
      /no such table: experiments/,
    );
    expect(existsSync(part)).toBe(false);
    expect(existsSync(out)).toBe(false);
  });
});
