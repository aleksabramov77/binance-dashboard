import { describe, expect, it } from "vitest";
import {
  getAppHost,
  getDatabaseConfig,
  getDbSizeLimit,
  getTelegramConfig,
  isServerless,
} from "./env.server";

const URL =
  "postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";

describe("isServerless", () => {
  it("true только при VERCEL=1", () => {
    expect(isServerless({ VERCEL: "1" })).toBe(true);
    expect(isServerless({})).toBe(false);
    expect(isServerless({ VERCEL: "" })).toBe(false);
  });
});

describe("getAppHost", () => {
  it("vercel при VERCEL=1, vm при APP_HOST=vm, иначе local", () => {
    expect(getAppHost({ VERCEL: "1" })).toBe("vercel");
    expect(getAppHost({ APP_HOST: "vm" })).toBe("vm");
    expect(getAppHost({ APP_HOST: " vm " })).toBe("vm");
    expect(getAppHost({})).toBe("local");
    expect(getAppHost({ APP_HOST: "mac" })).toBe("local");
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

describe("getDbSizeLimit", () => {
  const MB = 1024 * 1024;

  it("по умолчанию 500 МБ (Supabase Free)", () => {
    expect(getDbSizeLimit({})).toEqual({ limitBytes: 500 * MB, invalid: null });
    expect(getDbSizeLimit({ DB_SIZE_LIMIT_MB: " " }).invalid).toBeNull();
  });

  it("берёт DB_SIZE_LIMIT_MB", () => {
    expect(getDbSizeLimit({ DB_SIZE_LIMIT_MB: "8192" })).toEqual({
      limitBytes: 8192 * MB,
      invalid: null,
    });
  });

  it("некорректное значение — 500 МБ и само значение для предупреждения", () => {
    for (const raw of ["abc", "0", "-5", "Infinity"])
      expect(getDbSizeLimit({ DB_SIZE_LIMIT_MB: raw })).toEqual({
        limitBytes: 500 * MB,
        invalid: raw,
      });
  });
});

describe("getTelegramConfig", () => {
  it("секрет webhook — необязательный", () => {
    expect(getTelegramConfig({ TELEGRAM_BOT_TOKEN: "t" })).toEqual({
      token: "t",
      chatId: null,
      webhookSecret: null,
    });
    expect(
      getTelegramConfig({
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_CHAT_ID: "42",
        TELEGRAM_WEBHOOK_SECRET: "s",
      }),
    ).toEqual({ token: "t", chatId: "42", webhookSecret: "s" });
    expect(getTelegramConfig({ TELEGRAM_WEBHOOK_SECRET: "s" })).toBeNull();
  });
});
