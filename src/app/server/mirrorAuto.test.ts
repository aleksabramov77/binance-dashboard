import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDbExperimentStore,
  ensureRun,
  experimentsTable,
  readMirrorAutoRows,
  runsTable,
  seedExperiments,
} from "@/entities/experiment";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { log, setNotifyChannels } from "@/shared/lib/logger.server";
import type { NotifyChannel } from "@/shared/notify";
import { runMirrorAuto } from "./mirrorAuto";

// Авто-зеркало без биржи (spec 0043): БД — SQLite в памяти, журнал — моки, уведомление — настоящий log.notify с
// фиктивным каналом (spec 0067).
let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
// Чтение данных для решения — настоящее; тесты гонок вклиниваются между чтением и записью.
vi.mock("@/entities/experiment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/experiment")>();
  return { ...actual, readMirrorAutoRows: vi.fn(actual.readMirrorAutoRows) };
});
vi.mock("@/shared/lib/logger.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/lib/logger.server")>();
  return {
    ...actual,
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      notify: vi.fn(actual.log.notify),
    },
  };
});

const channel = {
  name: "test",
  deliver: vi.fn<NotifyChannel["deliver"]>(),
};

const ENV = {
  BINANCE_DEMO_API_KEY: "k",
  BINANCE_DEMO_API_SECRET: "s",
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_CHAT_ID: "1",
};

beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubEnv("NODE_ENV", "production");
  channel.deliver.mockReset();
  channel.deliver.mockImplementation(async () => ({ status: "sent" }));
  setNotifyChannels([channel]);
  vi.mocked(log.info).mockClear();
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.notify).mockClear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setNotifyChannels([]);
  await close();
});

const exp = (id: string, over: Partial<Experiment> = {}): Experiment => ({
  id,
  market: "spot",
  name: id,
  hypothesis: "тест",
  config: {
    timeframe: "1h",
    entry: { type: "hold" },
    exit: { stop: { type: "none" }, takeProfit: null },
    universe: { type: "majors" },
    directions: ["long"],
    maxOpen: 1,
  },
  initialBudget: 10_000,
  enabled: true,
  demoMirror: false,
  ...over,
});

const closed = (
  id: string,
  runId: number,
  experimentId: string,
  rMultiple: number,
): PaperTrade => {
  // Сделки — за последний час: после старта эпохи (сдвинут на 2 ч назад), до любого изменения зеркала в тесте.
  const openedAt = new Date(
    Date.now() - 3_600_000 + Number(id.slice(1)) * 1000,
  );
  return {
    id,
    runId,
    experimentId,
    market: "spot",
    symbol: "ETHUSDT",
    direction: "long",
    openedAt: openedAt.toISOString(),
    entryPrice: 100,
    quantity: 0.5,
    initialStop: 95,
    stop: 95,
    takeProfit: 110,
    atr: 1,
    extreme: 100,
    checkedUntil: 0,
    closedAt: new Date(openedAt.getTime() + 60_000).toISOString(),
    exitPrice: 105,
    exitReason: "tp",
    fees: 0,
    pnl: 2.5,
    rMultiple,
    demoOrderRef: null,
    mae: null,
    entryContext: {},
    signal: {},
  };
};

/** S98 — «Авто», выкл; PS99 — ручное «Выкл»; у обоих 30 прибыльных сделок. */
async function setup() {
  await seedExperiments(db, [exp("S98"), exp("PS99")]);
  await db
    .update(experimentsTable)
    .set({ demoMirrorMode: "off" })
    .where(eq(experimentsTable.id, "PS99"));
  const runId = await ensureRun(db);
  await db
    .update(runsTable)
    .set({ startedAt: new Date(Date.now() - 2 * 3_600_000) })
    .where(eq(runsTable.id, runId));
  const store = createDbExperimentStore(db);
  for (let i = 0; i < 30; i++) {
    await store.insertTrade(closed(`a${i}`, runId, "S98", 0.2));
    await store.insertTrade(closed(`b${i}`, runId, "PS99", 0.2));
  }
}

const flags = async () =>
  Object.fromEntries(
    (
      await db
        .select({
          id: experimentsTable.id,
          demoMirror: experimentsTable.demoMirror,
          advice: experimentsTable.demoMirrorAdvice,
        })
        .from(experimentsTable)
    ).map((r) => [r.id, r]),
  );

describe("runMirrorAuto", () => {
  it("dry-run — тот же план без записи в БД, журнала и уведомлений", async () => {
    await setup();
    const r = await runMirrorAuto({ dryRun: true });
    expect(r.changes.map((c) => c.message)).toEqual([
      "S98 → демо-зеркало включено: 30 сделок, средний R +0.20",
    ]);
    expect(r.advice.map((a) => a.id)).toEqual(["PS99"]);
    expect(await flags()).toMatchObject({
      S98: { demoMirror: false },
      PS99: { advice: null },
    });
    expect(log.notify).not.toHaveBeenCalled();
    expect(channel.deliver).not.toHaveBeenCalled();
  });

  it("включает «Авто», ручное не трогает; запись с уведомлением «Лаборатория», тихо; подсказка не повторяется", async () => {
    await setup();
    const r = await runMirrorAuto();
    expect(await flags()).toMatchObject({
      S98: { demoMirror: true },
      PS99: { demoMirror: false, advice: "on" },
    });
    expect(r.notify).toEqual({ sent: 2, failed: 0, skipped: null });
    expect(log.notify).toHaveBeenCalledWith({
      level: "info",
      event: "mirror.auto",
      message: "S98 → демо-зеркало включено: 30 сделок, средний R +0.20",
      data: expect.objectContaining({ experimentId: "S98" }),
      category: "lab",
    });
    expect(log.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "mirror.advice",
        message: expect.stringContaining("💡 PS99"),
        data: expect.objectContaining({ experimentId: "PS99" }),
        category: "lab",
      }),
    );
    expect(channel.deliver.mock.calls.map(([n]) => n.urgent)).toEqual([
      false,
      false,
    ]);

    channel.deliver.mockClear();
    const again = await runMirrorAuto();
    // S98 теперь вкл с новым окном (сделок после включения нет), PS99 — подсказка уже отправлена.
    expect(again.changes).toEqual([]);
    expect(again.advice).toEqual([]);
    expect(channel.deliver).not.toHaveBeenCalled();

    // «Оставил включённым» не затирает, почему автомат включил: последнее изменение — прежнее, проверка — новая.
    const [s98] = await db
      .select({ auto: experimentsTable.demoMirrorAuto })
      .from(experimentsTable)
      .where(eq(experimentsTable.id, "S98"));
    expect(s98.auto).toMatchObject({
      check: { decision: "keep", demoMirror: true, trades: 0, avgR: null },
      change: { decision: "enable", demoMirror: true, trades: 30 },
    });
  });

  it("канал не отправил (не production) — только журнал; сбой канала не отменяет изменения", async () => {
    await setup();
    channel.deliver.mockResolvedValue({
      status: "skipped",
      reason: "не production",
    });
    const local = await runMirrorAuto({ ids: ["S98"] });
    expect(local.notify).toEqual({
      sent: 0,
      failed: 0,
      skipped: "не production",
    });
    expect((await flags()).S98.demoMirror).toBe(true);

    channel.deliver.mockRejectedValue(new Error("сеть"));
    const failed = await runMirrorAuto({ ids: ["PS99"] });
    expect(failed.notify).toMatchObject({ sent: 0, failed: 1 });
    expect((await flags()).PS99.advice).toBe("on");
    // Итог — в записи журнала: «не отправлено: сеть».
    const records = await Promise.all(
      vi.mocked(log.notify).mock.results.map((r) => r.value),
    );
    expect(records.at(-1)).toMatchObject({ status: "failed", reason: "сеть" });
  });

  it("без ключа Binance Demo ничего не включает и пишет причину", async () => {
    await setup();
    vi.stubEnv("BINANCE_DEMO_API_KEY", "");
    const r = await runMirrorAuto();
    expect(r.demoConfigured).toBe(false);
    expect(r.reason).toMatch(/ключ Binance Demo/);
    expect(r.changes).toEqual([]);
    expect((await flags()).S98.demoMirror).toBe(false);
  });

  it("положение переключили между чтением и записью — подсказки нет ни в журнале, ни в уведомлениях", async () => {
    await setup();
    const read = vi.mocked(readMirrorAutoRows);
    const actual = read.getMockImplementation();
    read.mockImplementationOnce(async (...args) => {
      const data = await actual?.(...args);
      await db
        .update(experimentsTable)
        .set({ demoMirrorMode: "on", demoMirror: true })
        .where(eq(experimentsTable.id, "PS99"));
      return data ?? null;
    });
    const r = await runMirrorAuto({ ids: ["PS99"] });
    expect(r.advice).toEqual([]);
    expect(log.notify).not.toHaveBeenCalled();
    expect(channel.deliver).not.toHaveBeenCalled();
    expect((await flags()).PS99.advice).toBeNull();
  });

  it("две проверки параллельно — подсказка уходит один раз", async () => {
    await setup();
    const read = vi.mocked(readMirrorAutoRows);
    const actual = read.getMockImplementation();
    let second: Awaited<ReturnType<typeof runMirrorAuto>> | null = null;
    // Первая прочитала данные, вторая успела пройти целиком, потом первая пишет.
    read.mockImplementationOnce(async (...args) => {
      const data = await actual?.(...args);
      second = await runMirrorAuto({ ids: ["PS99"] });
      return data ?? null;
    });
    const first = await runMirrorAuto({ ids: ["PS99"] });
    expect(second).toMatchObject({ advice: [{ id: "PS99", advice: "on" }] });
    expect(first.advice).toEqual([]);
    expect(channel.deliver).toHaveBeenCalledTimes(1);
  });
});
