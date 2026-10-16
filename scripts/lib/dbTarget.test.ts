import { describe, expect, it } from "vitest";
import {
  describeDatabase,
  PROD_SNAPSHOT_PATH,
  PROD_WRITE_HINT,
} from "./dbTarget";

describe("describeDatabase", () => {
  it("файл SQLite — путь; снимок прода — с пометкой", () => {
    expect(describeDatabase({ kind: "sqlite", path: "data/app.db" })).toBe(
      "SQLite data/app.db",
    );
    expect(describeDatabase({ kind: "sqlite", path: PROD_SNAPSHOT_PATH })).toBe(
      "SQLite data/prod.db (снимок прод-базы, pnpm db:pull)",
    );
    expect(describeDatabase({ kind: "sqlite", path: ":memory:" })).toBe(
      "SQLite в памяти",
    );
  });

  it("подсказка отказа в прод называет страницы с тумблерами", () => {
    expect(PROD_WRITE_HINT).toContain("/experiments");
    expect(PROD_WRITE_HINT).toContain("/settings");
  });
});
