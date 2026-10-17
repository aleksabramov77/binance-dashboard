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
import { freePctOf } from "@/features/db-space";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { log, setNotifyChannels } from "@/shared/lib/logger.server";
import type { NotifyChannel } from "@/shared/notify";
import { checkDbSpace } from "./dbSpace";

// Пороги места в базе с уведомлением (spec 0067): тема «Сервер», ≤ 20 % — со звуком, 50 / 40 / 30 % — тихо;
// недоставленное повторяется, неотправленное (не production) — отмечается. База — SQLite в памяти, процент — мок.
let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
  getDbPath: () => ":memory:",
}));
vi.mock("@/features/db-space", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/db-space")>()),
  freePctOf: vi.fn(() => 35),
}));
vi.mock("@/shared/lib/logger.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/lib/logger.server")>();
  return {
    ...actual,
    log: { ...actual.log, notify: vi.fn(actual.log.notify) },
  };
});

const channel = {
  name: "test",
  deliver: vi.fn<NotifyChannel["deliver"]>(),
};
const free = (pct: number) => vi.mocked(freePctOf).mockReturnValue(pct);

beforeAll(async () => {
  ({ db, close } = await createMemoryDb());
}, 60_000);
afterAll(() => close());
beforeEach(() => {
  db.run("delete from alert_state");
  channel.deliver.mockReset();
  channel.deliver.mockImplementation(async () => ({ status: "sent" }));
  setNotifyChannels([channel]);
});
afterEach(() => {
  setNotifyChannels([]);
  vi.clearAllMocks();
});

describe("checkDbSpace — уведомление о пороге", () => {
  it("40 % — тихо, 20 % — со звуком; категория «Сервер», текст порога как раньше", async () => {
    free(35);
    expect(await checkDbSpace()).toMatchObject({ notified: 40, sent: true });
    free(18);
    expect(await checkDbSpace()).toMatchObject({ notified: 20, sent: true });
    expect(
      channel.deliver.mock.calls.map(([n]) => [n.category, n.urgent]),
    ).toEqual([
      ["server", false],
      ["server", true],
    ]);
    expect(channel.deliver.mock.calls[0][0].text).toMatch(
      /^⚠️ Свободного места в базе ≤ 40 %\n/,
    );
    expect(vi.mocked(log.notify).mock.calls[0][0]).toMatchObject({
      level: "warn",
      event: "monitor.db_space",
      message: "Свободного места в базе ≤ 40 % (35 %)",
      data: { notified: 40, freePct: 35 },
    });
  });

  it("не доставлено — порог не отмечен, следующий прогон повторяет", async () => {
    free(35);
    channel.deliver.mockResolvedValueOnce({
      status: "failed",
      reason: "Telegram sendMessage 502",
    });
    expect(await checkDbSpace()).toMatchObject({ notified: 40, sent: false });
    expect(await checkDbSpace()).toMatchObject({ notified: 40, sent: true });
    expect(await checkDbSpace()).toMatchObject({ notified: null });
    expect(channel.deliver).toHaveBeenCalledTimes(2);
  });

  it("не отправлялось (не production, канал не настроен) — порог отмечен, повтора нет", async () => {
    free(35);
    channel.deliver.mockResolvedValueOnce({
      status: "skipped",
      reason: "не production",
    });
    expect(await checkDbSpace()).toMatchObject({ notified: 40, sent: false });
    expect(await checkDbSpace()).toMatchObject({ notified: null });
    expect(channel.deliver).toHaveBeenCalledTimes(1);
  });
});
