import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { accountKeysTable } from "@/entities/account-key";
import type { ReadKeyFlags } from "@/shared/api/binance";
import { BinanceApiError } from "@/shared/api/binance/account.server";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import {
  type AccountKeyDeps,
  deleteAccountKey,
  getAccountKeyStatus,
  getMainCredentials,
  resetMainCredentialsCache,
  saveAccountKey,
} from "./accountKey";

let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const API_KEY = `vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duAB12`;
const API_SECRET = `NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j`;
const INPUT = { apiKey: API_KEY, apiSecret: API_SECRET };

const READ_ONLY: ReadKeyFlags = {
  ipRestrict: true,
  enableReading: true,
  enableSpotAndMarginTrading: false,
  enableFutures: false,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  permitsUniversalTransfer: false,
  enableMargin: false,
  enableVanillaOptions: false,
  enablePortfolioMarginTrading: false,
};

const SAVED_AT = new Date("2026-10-17T10:00:00Z");
const deps = (
  fetchRestrictions: AccountKeyDeps["fetchRestrictions"] = async () =>
    READ_ONLY,
): AccountKeyDeps => ({ fetchRestrictions, now: () => SAVED_AT });

const dir = mkdtempSync(path.join(tmpdir(), "account-key-"));
const masterFile = (name: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, `${randomBytes(32).toString("base64")}\n`);
  return file;
};
const MASTER = masterFile("master.key");

/** Всё, что ушло в журнал, одной строкой — для проверки «секретов нет». */
const logged = () =>
  JSON.stringify(
    [log.debug, log.info, log.warn, log.error].flatMap(
      (fn) => vi.mocked(fn).mock.calls,
    ),
  );
const events = (level: "info" | "warn" | "error") =>
  vi.mocked(log[level]).mock.calls.map(([event]) => event);

beforeAll(async () => {
  ({ db, close } = await createMemoryDb());
}, 60_000);
afterAll(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.delete(accountKeysTable).run();
  resetMainCredentialsCache();
  vi.stubEnv("BINANCE_API_KEY", "");
  vi.stubEnv("BINANCE_API_SECRET", "");
  vi.stubEnv("SECRETS_KEY_FILE", MASTER);
  vi.stubEnv("APP_HOST", "vm");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getMainCredentials: база → env → нет", () => {
  it("в базе пусто, env пуст — ключа нет", () => {
    expect(getMainCredentials()).toBeNull();
    expect(getAccountKeyStatus()).toMatchObject({
      source: "none",
      stored: null,
      decryptFailed: false,
      input: { available: true, reason: null },
      hosting: "cloud",
    });
  });

  it("в базе пусто — ключ из env (локально, .env.local)", () => {
    vi.stubEnv("BINANCE_API_KEY", "env-key");
    vi.stubEnv("BINANCE_API_SECRET", "env-secret");
    vi.stubEnv("APP_HOST", "");
    expect(getMainCredentials()).toEqual({
      apiKey: "env-key",
      apiSecret: "env-secret",
    });
    expect(getAccountKeyStatus()).toMatchObject({
      source: "env",
      hosting: "local",
    });
  });

  it("ключ в базе главнее env", async () => {
    vi.stubEnv("BINANCE_API_KEY", "env-key");
    vi.stubEnv("BINANCE_API_SECRET", "env-secret");
    expect(getMainCredentials()?.apiKey).toBe("env-key");
    await saveAccountKey(INPUT, { by: "owner" }, deps());
    expect(getMainCredentials()).toEqual(INPUT);
    expect(getAccountKeyStatus().source).toBe("db");
  });

  it("кэш процесса: база читается один раз; сохранение и удаление сбрасывают кэш", async () => {
    expect(getMainCredentials()).toBeNull();
    await saveAccountKey(INPUT, { by: null }, deps());
    expect(getMainCredentials()).toEqual(INPUT);
    // Запись стёрта в обход deleteAccountKey — процесс помнит ключ, пока кэш не сброшен.
    db.delete(accountKeysTable).run();
    expect(getMainCredentials()).toEqual(INPUT);
    deleteAccountKey({ by: null });
    expect(getMainCredentials()).toBeNull();
  });
});

describe("saveAccountKey", () => {
  it("годный ключ: проверка прав → в базе зашифрован, статус «…AB12», права, время", async () => {
    const fetchRestrictions = vi.fn(async () => READ_ONLY);
    const result = await saveAccountKey(
      INPUT,
      { by: "owner" },
      deps(fetchRestrictions),
    );
    expect(fetchRestrictions).toHaveBeenCalledWith(INPUT);
    expect(result).toEqual({
      ok: true,
      status: {
        source: "db",
        stored: {
          hint: "AB12",
          savedAt: SAVED_AT.toISOString(),
          flags: READ_ONLY,
        },
        decryptFailed: false,
        input: { available: true, reason: null },
        hosting: "cloud",
      },
    });
    const row = db.select().from(accountKeysTable).get();
    expect(row).toMatchObject({ name: "binance-main", keyHint: "AB12" });
    expect(JSON.stringify(row)).not.toContain(API_KEY);
    expect(JSON.stringify(row)).not.toContain(API_SECRET);
    expect(events("info")).toEqual(["account-key.saved"]);
  });

  it("повторное сохранение заменяет ключ (та же запись, новый IV)", async () => {
    await saveAccountKey(INPUT, { by: null }, deps());
    const first = db.select().from(accountKeysTable).get();
    const other = {
      apiKey: `${API_KEY.slice(0, -4)}CD34`,
      apiSecret: API_SECRET,
    };
    await saveAccountKey(other, { by: null }, deps());
    const rows = db.select().from(accountKeysTable).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].keyHint).toBe("CD34");
    expect(rows[0].iv).not.toBe(first?.iv);
    expect(getMainCredentials()).toEqual(other);
  });

  it("ключ с выводом и торговлей — не сохраняется, причины по каждому пункту", async () => {
    const result = await saveAccountKey(
      INPUT,
      { by: null },
      deps(async () => ({
        ...READ_ONLY,
        enableWithdrawals: true,
        enableSpotAndMarginTrading: true,
        ipRestrict: false,
      })),
    );
    expect(result).toMatchObject({ ok: false, status: 422 });
    if (result.ok) return;
    expect(result.reasons).toEqual([
      expect.stringMatching(/ограничения по IP/),
      expect.stringMatching(/торговля Spot/),
      expect.stringMatching(/вывод средств.*Enable Withdrawals/),
    ]);
    expect(result.flags?.enableWithdrawals).toBe(true);
    expect(db.select().from(accountKeysTable).all()).toHaveLength(0);
    expect(events("warn")).toEqual(["account-key.rejected"]);
    expect(vi.mocked(log.warn).mock.calls[0][2]).toMatchObject({
      hint: "AB12",
      reasons: result.reasons,
    });
  });

  it("Binance отклонил ключ (-2015) — не сохраняется, в ответе ошибка Binance без ключа", async () => {
    const result = await saveAccountKey(
      INPUT,
      { by: null },
      deps(async () => {
        // Даже если бы биржа повторила ключ в тексте ошибки — он вычищается.
        throw new BinanceApiError(
          `Binance: Invalid API-key ${API_KEY}, IP, or permissions for action. (-2015)`,
          -2015,
          401,
        );
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 422,
      error: expect.stringMatching(/^Binance отклонил ключ: .*-2015/),
      reasons: [expect.stringMatching(/IP-whitelist/)],
    });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(db.select().from(accountKeysTable).all()).toHaveLength(0);
  });

  it("Binance не ответил — 502, ключ не сохранён", async () => {
    const result = await saveAccountKey(
      INPUT,
      { by: null },
      deps(async () => {
        throw new Error(`fetch failed for ${API_SECRET}`);
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 502,
      error: "Binance не ответил: fetch failed for ***",
    });
    expect(db.select().from(accountKeysTable).all()).toHaveLength(0);
  });

  it("мастер-ключ не задан — ввод недоступен (409), Binance не спрашивается", async () => {
    vi.stubEnv("SECRETS_KEY_FILE", "");
    const fetchRestrictions = vi.fn(async () => READ_ONLY);
    const result = await saveAccountKey(
      INPUT,
      { by: null },
      deps(fetchRestrictions),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringMatching(/не задан мастер-ключ/),
    });
    expect(fetchRestrictions).not.toHaveBeenCalled();
    expect(getAccountKeyStatus().input).toEqual({
      available: false,
      reason: expect.stringMatching(/SECRETS_KEY_FILE/),
    });
  });

  it("файл мастер-ключа задан, но его нет — ввод недоступен с причиной", () => {
    vi.stubEnv("SECRETS_KEY_FILE", path.join(dir, "missing.key"));
    expect(getAccountKeyStatus().input).toEqual({
      available: false,
      reason: expect.stringMatching(/ENOENT/),
    });
  });
});

describe("deleteAccountKey", () => {
  it("стирает запись, ключа снова нет; журнал — только подсказка", async () => {
    await saveAccountKey(INPUT, { by: null }, deps());
    const status = deleteAccountKey({ by: "owner" });
    expect(status).toMatchObject({ source: "none", stored: null });
    expect(getMainCredentials()).toBeNull();
    expect(events("info")).toEqual([
      "account-key.saved",
      "account-key.deleted",
    ]);
  });

  it("удаление без ключа — без записи в журнал", () => {
    deleteAccountKey({ by: null });
    expect(events("info")).toEqual([]);
  });
});

describe("мастер-ключ пропал или сменился", () => {
  it("ключ не расшифровывается: как «ключа нет», одна запись decrypt-failed, статус с пометкой", async () => {
    await saveAccountKey(INPUT, { by: null }, deps());
    vi.stubEnv("SECRETS_KEY_FILE", masterFile("other.key"));
    resetMainCredentialsCache();
    expect(getMainCredentials()).toBeNull();
    expect(getMainCredentials()).toBeNull();
    const status = getAccountKeyStatus();
    expect(status).toMatchObject({
      source: "none",
      decryptFailed: true,
      stored: { hint: "AB12" },
      input: { available: true },
    });
    expect(events("error")).toEqual(["account-key.decrypt-failed"]);
    expect(vi.mocked(log.error).mock.calls[0][2]).toMatchObject({
      hint: "AB12",
    });
  });

  it("файла мастер-ключа больше нет — тоже decrypt-failed, приложение работает", async () => {
    await saveAccountKey(INPUT, { by: null }, deps());
    vi.stubEnv("SECRETS_KEY_FILE", "");
    resetMainCredentialsCache();
    expect(getMainCredentials()).toBeNull();
    expect(getAccountKeyStatus()).toMatchObject({
      decryptFailed: true,
      input: { available: false },
    });
    expect(events("error")).toEqual(["account-key.decrypt-failed"]);
  });

  it("ввод ключа заново после смены мастер-ключа — снова работает", async () => {
    await saveAccountKey(INPUT, { by: null }, deps());
    vi.stubEnv("SECRETS_KEY_FILE", masterFile("new.key"));
    resetMainCredentialsCache();
    expect(getMainCredentials()).toBeNull();
    await saveAccountKey(INPUT, { by: null }, deps());
    expect(getMainCredentials()).toEqual(INPUT);
    expect(getAccountKeyStatus().decryptFailed).toBe(false);
  });
});

describe("AC6: ключ и секрет нигде не видны", () => {
  it("журнал и статусы всех сценариев — без ключа и секрета", async () => {
    const outputs: unknown[] = [];
    outputs.push(await saveAccountKey(INPUT, { by: null }, deps()));
    outputs.push(
      await saveAccountKey(
        INPUT,
        { by: null },
        deps(async () => ({ ...READ_ONLY, enableFutures: true })),
      ),
    );
    outputs.push(
      await saveAccountKey(
        INPUT,
        { by: null },
        deps(async () => {
          throw new BinanceApiError(`bad ${API_KEY} ${API_SECRET}`, -2014, 400);
        }),
      ),
    );
    outputs.push(getAccountKeyStatus());
    vi.stubEnv("SECRETS_KEY_FILE", masterFile("rotated.key"));
    resetMainCredentialsCache();
    getMainCredentials();
    outputs.push(getAccountKeyStatus());
    outputs.push(deleteAccountKey({ by: null }));
    const text = `${JSON.stringify(outputs)}${logged()}`;
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain(API_SECRET);
    expect(text).toContain("AB12");
  });
});
