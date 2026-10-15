import { describe, expect, it } from "vitest";
import { describeDatabase, isLocalDatabase } from "./dbTarget";

describe("describeDatabase", () => {
  it("Postgres: хост, порт и база без пароля", () => {
    const text = describeDatabase({
      kind: "postgres",
      url: "postgresql://postgres.abc:s3cret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    });
    expect(text).toBe(
      "Postgres aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    );
    expect(text).not.toContain("s3cret");
  });
  it("PGlite — каталог; битый URL не ломает вывод", () => {
    expect(describeDatabase({ kind: "pglite", dir: "data/pglite" })).toBe(
      "локальная PGlite (data/pglite)",
    );
    expect(describeDatabase({ kind: "postgres", url: "::нет::" })).toBe(
      "Postgres (DATABASE_URL)",
    );
  });
  it("isLocalDatabase", () => {
    expect(isLocalDatabase({ kind: "pglite", dir: "x" })).toBe(true);
    expect(isLocalDatabase({ kind: "postgres", url: "postgres://a/b" })).toBe(
      false,
    );
  });
});
