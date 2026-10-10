import { describe, expect, it } from "vitest";
import { getDatabaseConfig, isServerless } from "./env.server";

const URL =
  "postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";

describe("isServerless", () => {
  it("true только при VERCEL=1", () => {
    expect(isServerless({ VERCEL: "1" })).toBe(true);
    expect(isServerless({})).toBe(false);
    expect(isServerless({ VERCEL: "" })).toBe(false);
  });
});

describe("getDatabaseConfig", () => {
  it("Postgres по DATABASE_URL — локально и на Vercel", () => {
    expect(getDatabaseConfig({ DATABASE_URL: URL })).toEqual({
      kind: "postgres",
      url: URL,
    });
    expect(getDatabaseConfig({ DATABASE_URL: URL, VERCEL: "1" }).kind).toBe(
      "postgres",
    );
  });

  it("без DATABASE_URL локально — PGlite в data/pglite", () => {
    expect(getDatabaseConfig({})).toEqual({
      kind: "pglite",
      dir: "data/pglite",
    });
  });

  it("без DATABASE_URL на Vercel — понятная ошибка вместо PGlite", () => {
    expect(() => getDatabaseConfig({ VERCEL: "1" })).toThrow(/DATABASE_URL/);
    expect(() => getDatabaseConfig({ VERCEL: "1", DATABASE_URL: "" })).toThrow(
      /DATABASE_URL/,
    );
  });
});
