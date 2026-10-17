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
import {
  type LiveHeartbeat,
  liveWorkerStateTable,
} from "@/entities/live-account";
import { MAIN_UID_PENDING_REASON } from "@/shared/api/binance";
import { fetchAccountUid } from "@/shared/api/binance/account.server";
import { sendTelegramMessage } from "@/shared/api/telegram";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import {
  checkLiveSilence,
  clearMainAccountUidCache,
  getLiveStatusView,
  ingestHeartbeat,
  notifyLive,
} from "./liveAccount";

let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
vi.mock("@/shared/api/binance/account.server", () => ({
  fetchAccountUid: vi.fn(),
}));
vi.mock("@/shared/api/telegram", () => ({ sendTelegramMessage: vi.fn() }));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const T0 = Date.parse("2026-10-16T12:00:00Z");
const MIN = 60_000;

const pulse = (over: Partial<LiveHeartbeat> = {}): LiveHeartbeat => ({
  version: "test",
  handshake: false,
  sentAt: new Date(T0).toISOString(),
  fixture: null,
  verdict: "ok",
  reasons: [],
  warnings: [],
  restrictions: { flags: null, checkedAt: null },
  uid: { status: "different", note: null },
  spot: null,
  usdm: null,
  balancesNote: null,
  error: null,
  ...over,
});

const statusLogs = () =>
  [...vi.mocked(log.info).mock.calls, ...vi.mocked(log.warn).mock.calls]
    .filter(([event]) => event === "live.status")
    .map(([, message, data]) => ({ message, telegram: data?.telegram }));

// Одна SQLite с миграциями на файл (создание медленное), строка пульса чистится перед каждым тестом.
beforeAll(async () => {
  ({ db, close } = await createMemoryDb());
}, 60_000);
afterAll(() => close());

beforeEach(async () => {
  await db.delete(liveWorkerStateTable);
  clearMainAccountUidCache();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot");
  vi.stubEnv("TELEGRAM_CHAT_ID", "42");
  vi.stubEnv("SITE_URL", "https://binance.example.test");
  vi.stubEnv("BINANCE_API_KEY", "ro-key");
  vi.stubEnv("BINANCE_API_SECRET", "ro-secret");
  vi.stubEnv("LIVE_SILENT_AFTER_SEC", "");
  vi.mocked(fetchAccountUid).mockResolvedValue(777);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("ingestHeartbeat", () => {
  it("первый пульс — запись и Telegram; тот же — без повторов; смена — снова одно сообщение", async () => {
    await ingestHeartbeat(pulse(), T0);
    await ingestHeartbeat(pulse(), T0 + MIN);
    await ingestHeartbeat(
      pulse({
        verdict: "blocked",
        reasons: ["у ключа разрешён вывод средств"],
      }),
      T0 + 2 * MIN,
    );
    await ingestHeartbeat(
      pulse({
        verdict: "blocked",
        reasons: ["у ключа разрешён вывод средств"],
      }),
      T0 + 3 * MIN,
    );
    expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendTelegramMessage).mock.calls[1][2]).toMatch(
      /ключ заблокирован: у ключа разрешён вывод средств\nhttps:\/\/binance\.example\.test\/settings#live$/,
    );
    expect(statusLogs()).toHaveLength(2);
    const view = await getLiveStatusView();
    expect(view.state?.status).toBe("blocked");
    expect(view.state?.receivedAt).toBe(new Date(T0 + 3 * MIN).toISOString());
  });

  it("ответ — UID основного счёта по read-only ключу (кэш), без ключа — пропуск с причиной", async () => {
    expect(await ingestHeartbeat(pulse(), T0)).toEqual({
      ok: true,
      verdict: "ok",
      mainAccount: { uid: 777 },
    });
    await ingestHeartbeat(pulse(), T0 + MIN);
    expect(fetchAccountUid).toHaveBeenCalledTimes(1);

    clearMainAccountUidCache();
    vi.stubEnv("BINANCE_API_KEY", "");
    const reply = await ingestHeartbeat(pulse(), T0 + 2 * MIN);
    expect(reply.mainAccount).toEqual({
      uid: null,
      reason: expect.stringMatching(/read-only ключ/),
      transient: false,
    });
  });

  it("ошибка чтения UID: известный — отдаётся он, неизвестный — transient (воркер блокирует)", async () => {
    vi.mocked(fetchAccountUid).mockRejectedValueOnce(new Error("429"));
    expect((await ingestHeartbeat(pulse(), T0)).mainAccount).toEqual({
      uid: null,
      reason: "429",
      transient: true,
    });
    await ingestHeartbeat(pulse(), T0 + MIN);
    vi.mocked(fetchAccountUid).mockRejectedValueOnce(new Error("сеть"));
    expect(
      (await ingestHeartbeat(pulse(), T0 + 2 * 60 * MIN)).mainAccount,
    ).toEqual({ uid: 777 });
  });

  it("блокировка с uid pending, но по другой причине (ключ отвергнут) — сохраняется, не рукопожатие", async () => {
    await ingestHeartbeat(pulse(), T0);
    await ingestHeartbeat(
      pulse({
        verdict: "blocked",
        reasons: ["Binance не принял ключ: проверьте ключ и IP-whitelist"],
        uid: { status: "pending", note: MAIN_UID_PENDING_REASON },
      }),
      T0 + MIN,
    );
    const view = await getLiveStatusView(T0 + MIN);
    expect(view.state?.status).toBe("blocked");
    expect(view.state?.receivedAt).toBe(new Date(T0 + MIN).toISOString());
  });

  it("рукопожатие после старта (UID pending) не сохраняется и не даёт сообщений", async () => {
    await ingestHeartbeat(pulse(), T0);
    vi.clearAllMocks();
    vi.mocked(fetchAccountUid).mockResolvedValue(777);
    const handshake = pulse({
      handshake: true,
      verdict: "blocked",
      reasons: [MAIN_UID_PENDING_REASON],
      uid: { status: "pending", note: MAIN_UID_PENDING_REASON },
    });
    const reply = await ingestHeartbeat(handshake, T0 + MIN);
    expect(reply.mainAccount).toEqual({ uid: 777 });
    expect(statusLogs()).toEqual([]);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    const view = await getLiveStatusView(T0 + MIN);
    expect(view.state?.status).toBe("ok");
    expect(view.state?.receivedAt).toBe(new Date(T0).toISOString());
  });

  it("фикстура и ключ не задан — UID не запрашивается; фикстура в Telegram не пишет", async () => {
    const r = await ingestHeartbeat(pulse({ fixture: "ok" }), T0);
    expect(r.mainAccount).toBeUndefined();
    expect(
      (await ingestHeartbeat(pulse({ verdict: "no-key" }), T0 + MIN))
        .mainAccount,
    ).toBeUndefined();
    expect(fetchAccountUid).not.toHaveBeenCalled();
    expect(statusLogs()[0]).toEqual({
      message: expect.stringMatching(/фикстура ok/),
      telegram: "не отправлен: фикстура",
    });
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("не production (сервер worktree) — Telegram не отправляется, запись в журнале есть", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await ingestHeartbeat(pulse(), T0);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(statusLogs()[0].telegram).toBe("не отправлен: не production");
  });
});

describe("notifyLive", () => {
  it("ссылка — на адрес из SITE_URL", async () => {
    expect(await notifyLive("🟢 Реальная сделка")).toBe("отправлен");
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][2]).toBe(
      "Binance Dashboard · 🟢 Реальная сделка\nhttps://binance.example.test/settings#live",
    );
  });

  it("без SITE_URL — сообщение без ссылки, не на старый адрес Vercel", async () => {
    vi.stubEnv("SITE_URL", "");
    expect(await notifyLive("🟢 Реальная сделка")).toBe("отправлен");
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][2]).toBe(
      "Binance Dashboard · 🟢 Реальная сделка",
    );
  });
});

describe("checkLiveSilence", () => {
  it("пульса не было — null; молчит — одна запись; вернулся — запись «снова на связи»", async () => {
    expect(await checkLiveSilence(T0)).toBeNull();
    await ingestHeartbeat(pulse(), T0);
    vi.clearAllMocks();

    expect(await checkLiveSilence(T0 + 6 * MIN)).toEqual({
      lastHeartbeatAt: T0,
      silentAfterMs: 5 * MIN,
    });
    await checkLiveSilence(T0 + 21 * MIN);
    // state.status — оценка последнего пульса (для уведомлений), а current — «что сейчас»: воркер молчит.
    const view = await getLiveStatusView(T0 + 21 * MIN);
    expect(view.state?.status).toBe("ok");
    expect(view.state?.silentSince).not.toBeNull();
    expect(view.current).toEqual({
      kind: "silent",
      since: new Date(T0).toISOString(),
    });
    expect(statusLogs()).toEqual([
      {
        message: "Воркер реального счёта молчит: последний пульс 6 мин назад",
        telegram: undefined,
      },
    ]);

    await ingestHeartbeat(pulse(), T0 + 30 * MIN);
    expect(statusLogs().map((l) => l.message)).toEqual([
      "Воркер реального счёта снова на связи: молчал 30 мин",
      "Воркер реального счёта молчит: последний пульс 6 мин назад",
    ]);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});
