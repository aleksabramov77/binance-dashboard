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
import { resetMainCredentialsCache } from "@/app/server/accountKey";
import {
  type AccountKeyStatus,
  accountKeysTable,
} from "@/entities/account-key";
import {
  BinanceApiError,
  fetchApiRestrictions,
} from "@/shared/api/binance/account.server";
import { createMemoryDb, type Db } from "@/shared/db/client.server";

let db: Db;
let close: () => Promise<void>;

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/shared/lib/logger.server", async (orig) => ({
  ...(await orig<typeof import("@/shared/lib/logger.server")>()),
  log,
  flushLogs: vi.fn(async () => {}),
}));
vi.mock("@/shared/db/client.server", async (orig) => ({
  ...(await orig<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
// Binance — заглушка: реальных запросов с ключом нет.
vi.mock("@/shared/api/binance/account.server", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/binance/account.server")>()),
  fetchApiRestrictions: vi.fn(),
}));
vi.mock("@/app/server/auth", () => ({ nextAuth: null }));
// connection() работает только внутри запроса Next.
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => {},
}));
const { DELETE, GET, PUT } = await import("./route");

const API_KEY =
  "Z9rQe1LmT0pVb7XcN4sKd2HfJ8gAa6WuY3iOo5EtR1yUq0PlM9nBv7CxZ2kDEF56";
const API_SECRET =
  "s3cReTs3cReTs3cReTs3cReTs3cReTs3cReTs3cReTs3cReTs3cReTs3cReT0001";

const READ_ONLY = {
  ipRestrict: true,
  createTime: 1623840271000,
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableMargin: false,
  enableFutures: false,
  permitsUniversalTransfer: false,
  enableVanillaOptions: false,
  enableSpotAndMarginTrading: false,
};

const URL_ = "http://localhost/api/account-key";
const put = (body: unknown, type = "application/json") =>
  PUT(
    new Request(URL_, {
      method: "PUT",
      headers: { "content-type": type },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    undefined,
  );
const get = () => GET(new Request(URL_), undefined);
const del = () => DELETE(new Request(URL_, { method: "DELETE" }), undefined);

/** Все тексты ответов и журнала — для проверки «ключа и секрета нет». */
const seen: string[] = [];
const read = async (res: Response) => {
  const text = await res.text();
  seen.push(text);
  return JSON.parse(text);
};

const dir = mkdtempSync(path.join(tmpdir(), "account-key-route-"));
const MASTER = path.join(dir, "master.key");
writeFileSync(MASTER, randomBytes(32).toString("base64"));

beforeAll(async () => {
  ({ db, close } = await createMemoryDb());
}, 60_000);
afterAll(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
  const all = `${seen.join("\n")}${JSON.stringify(Object.values(log).map((fn) => fn.mock.calls))}`;
  // AC6 для всех тестов файла: ни ключ, ни секрет не попали в ответы API и журнал.
  expect(all).not.toContain(API_KEY);
  expect(all).not.toContain(API_SECRET);
});

beforeEach(() => {
  db.delete(accountKeysTable).run();
  resetMainCredentialsCache();
  vi.stubEnv("BINANCE_API_KEY", "");
  vi.stubEnv("BINANCE_API_SECRET", "");
  vi.stubEnv("SECRETS_KEY_FILE", MASTER);
  vi.stubEnv("APP_HOST", "vm");
  vi.mocked(fetchApiRestrictions).mockResolvedValue(READ_ONLY);
});
afterEach(() => {
  seen.push(JSON.stringify(Object.values(log).map((fn) => fn.mock.calls)));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/api/account-key", () => {
  it("GET без ключа — статус: ключа нет, ввод доступен", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({
      source: "none",
      stored: null,
      input: { available: true },
    });
  });

  it("PUT годного ключа → 200 и статус «…EF56»; GET — тот же статус; DELETE — ключа нет", async () => {
    const res = await put({ apiKey: API_KEY, apiSecret: API_SECRET });
    expect(res.status).toBe(200);
    const saved: AccountKeyStatus = await read(res);
    expect(saved).toMatchObject({
      source: "db",
      stored: { hint: "EF56", flags: { enableReading: true } },
    });
    expect(fetchApiRestrictions).toHaveBeenCalledWith({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
    });
    expect(await read(await get())).toEqual(saved);
    const removed = await del();
    expect(removed.status).toBe(200);
    expect(await read(removed)).toMatchObject({ source: "none", stored: null });
  });

  it.each([
    ["торговля", { enableSpotAndMarginTrading: true }, /торговля Spot/],
    ["фьючерсы", { enableFutures: true }, /фьючерсами/],
    ["вывод", { enableWithdrawals: true }, /вывод средств/],
    ["внутренние переводы", { enableInternalTransfer: true }, /внутренние/],
    [
      "универсальные переводы",
      { permitsUniversalTransfer: true },
      /универсальные/,
    ],
    ["маржа", { enableMargin: true }, /маржи/],
    ["без ограничения по IP", { ipRestrict: false }, /ограничения по IP/],
    ["опционы", { enableVanillaOptions: true }, /опционами/],
    [
      "Portfolio Margin",
      { enablePortfolioMarginTrading: true },
      /Portfolio Margin/,
    ],
  ])("PUT: %s — 422 с причиной, ключ не сохранён", async (_, flags, reason) => {
    vi.mocked(fetchApiRestrictions).mockResolvedValue({
      ...READ_ONLY,
      ...flags,
    });
    const res = await put({ apiKey: API_KEY, apiSecret: API_SECRET });
    expect(res.status).toBe(422);
    const body = await read(res);
    expect(body.reasons).toEqual([expect.stringMatching(reason)]);
    expect(db.select().from(accountKeysTable).all()).toHaveLength(0);
  });

  it("PUT: Binance отклонил ключ — 422 с ошибкой Binance", async () => {
    vi.mocked(fetchApiRestrictions).mockRejectedValue(
      new BinanceApiError(
        "Binance: Invalid API-key, IP, or permissions for action. (-2015)",
        -2015,
        401,
      ),
    );
    const res = await put({ apiKey: API_KEY, apiSecret: API_SECRET });
    expect(res.status).toBe(422);
    expect((await read(res)).error).toMatch(/Invalid API-key.*-2015/);
  });

  it("PUT не JSON — 415; тело не по схеме — 400 без введённого значения", async () => {
    const form = await put(
      `apiKey=${API_KEY}`,
      "application/x-www-form-urlencoded",
    );
    expect(form.status).toBe(415);
    await read(form);
    const short = await put({ apiKey: "abc", apiSecret: API_SECRET });
    expect(short.status).toBe(400);
    expect((await read(short)).error).toMatch(/API Key слишком короткий/);
    const bad = await put({ apiKey: `${API_KEY}!`, apiSecret: API_SECRET });
    expect(bad.status).toBe(400);
    expect((await read(bad)).error).toMatch(/только латинские буквы и цифры/);
    const extra = await put({ apiKey: API_KEY, apiSecret: API_SECRET, x: 1 });
    expect(extra.status).toBe(400);
    expect((await read(extra)).error).toBe(
      "Неверный запрос: нужны поля apiKey и apiSecret",
    );
    const notJson = await put("не json");
    expect(notJson.status).toBe(400);
    expect((await read(notJson)).error).toBe(
      "Неверный запрос: нужны поля apiKey и apiSecret",
    );
    const missing = await put({ apiKey: API_KEY });
    expect(missing.status).toBe(400);
    expect((await read(missing)).error).toBe("Вставьте Secret Key");
    expect(fetchApiRestrictions).not.toHaveBeenCalled();
  });

  it("без мастер-ключа: GET — ввод недоступен с причиной, PUT — 409", async () => {
    vi.stubEnv("SECRETS_KEY_FILE", "");
    expect((await read(await get())).input).toEqual({
      available: false,
      reason: expect.stringMatching(/не задан мастер-ключ/),
    });
    const res = await put({ apiKey: API_KEY, apiSecret: API_SECRET });
    expect(res.status).toBe(409);
    await read(res);
  });
});
