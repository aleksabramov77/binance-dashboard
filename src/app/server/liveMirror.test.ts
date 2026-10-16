import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
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
  createDbExperimentStore,
  ensureRun,
  experimentsTable,
  getLiveMirror,
  paperTradesTable,
  seedExperiments,
} from "@/entities/experiment";
import { liveWorkerStateTable, saveLiveState } from "@/entities/live-account";
import { sendTelegramMessage } from "@/shared/api/telegram";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import {
  claimLive,
  claimLiveClose,
  getLiveTradingView,
  liveCloseAll,
  liveHaltAction,
  liveMirrorState,
  saveLiveClose,
  saveLiveOpen,
  setLiveMirror,
  skipLive,
} from "./liveMirror";

// Хранилище реального зеркала без биржи (spec 0049): PGlite в памяти; Telegram и цены — моки. Id — фиктивные.
let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
vi.mock("@/shared/api/telegram", () => ({ sendTelegramMessage: vi.fn() }));
vi.mock("./tickerPrices", () => ({
  cachedTickerPrices: vi.fn(async () => new Map([["ETHUSDT", 110]])),
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const exp = (id: string, market: Experiment["market"]): Experiment => ({
  id,
  market,
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
});

const trade = (
  id: string,
  runId: number,
  experimentId: string,
  symbol = "ETHUSDT",
  market: PaperTrade["market"] = "usdm",
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market,
  symbol,
  direction: "long",
  openedAt: new Date().toISOString(),
  entryPrice: 100,
  quantity: 0.5,
  initialStop: 95,
  stop: 95,
  takeProfit: 110,
  atr: 1,
  extreme: 100,
  checkedUntil: 0,
  closedAt: null,
  exitPrice: null,
  exitReason: null,
  fees: 0,
  pnl: null,
  rMultiple: null,
  demoOrderRef: null,
  mae: null,
  entryContext: {},
  signal: {},
});

const actor = { by: "tester", authEnabled: true };
const okPulse = async () =>
  saveLiveState(db, {
    heartbeat: {
      version: "t",
      handshake: false,
      sentAt: new Date().toISOString(),
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
    },
    receivedAt: new Date().toISOString(),
    status: "ok",
    statusSince: new Date().toISOString(),
    silentSince: null,
  });

let runId: number;
beforeAll(async () => {
  ({ db, close } = await createMemoryDb());
  await seedExperiments(db, [
    exp("S98", "usdm"),
    exp("PS99", "spot"),
    exp("PC99", "coinm"),
  ]);
  runId = await ensureRun(db);
}, 60_000);
afterAll(() => close());

let n = 0;
const newTrade = async (experimentId: string, symbol = "ETHUSDT") => {
  const id = `t${++n}`;
  await createDbExperimentStore(db).insertTrade(
    trade(
      id,
      runId,
      experimentId,
      symbol,
      experimentId === "PS99" ? "spot" : "usdm",
    ),
  );
  return id;
};

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot");
  vi.stubEnv("TELEGRAM_CHAT_ID", "42");
  await db.delete(liveWorkerStateTable);
  await db.execute("delete from live_mirror_orders");
  await db.execute("delete from live_trading_halt");
  await db
    .update(experimentsTable)
    .set({ liveMirror: false })
    .where(eq(experimentsTable.liveMirror, true));
  await okPulse();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const toggleOn = (id: string, confirm = "РЕАЛ") =>
  setLiveMirror({ id, liveMirror: true, confirm }, actor);

describe("переключатель «Реальный счёт»", () => {
  it("включение — только со словом «РЕАЛ», при годном ключе; COIN-M — нельзя", async () => {
    expect(await toggleOn("S98", "реал?")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await toggleOn("PC99")).toMatchObject({
      ok: false,
      error: "COIN-M на реальном счёте не торгуется",
    });
    expect(await toggleOn("S98", " реал ")).toEqual({
      ok: true,
      id: "S98",
      liveMirror: true,
    });
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.info).mock.calls.map((c) => c[0])).toContain(
      "live.toggle",
    );
  });

  it("ключ не «✅» (воркер не подключён) — включить нельзя; выключить — можно", async () => {
    await db.delete(liveWorkerStateTable);
    expect(await toggleOn("S98")).toMatchObject({ ok: false, status: 409 });
    expect(
      await setLiveMirror({ id: "S98", liveMirror: false }, actor),
    ).toMatchObject({ ok: true });
  });
});

describe("захват, стоп и лимиты", () => {
  it("кандидаты — только включённые эксперименты; захват — один раз; монета — одна активная позиция", async () => {
    await toggleOn("S98");
    const a = await newTrade("S98");
    const b = await newTrade("S98");
    const state = await liveMirrorState();
    expect(state.candidates.map((c) => c.tradeId)).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect(await claimLive(a)).toEqual({ claimed: true, reason: null });
    expect(await claimLive(a)).toEqual({ claimed: false, reason: "taken" });
    // Та же монета рынка занята активной строкой — уникальный индекс.
    expect(await claimLive(b)).toEqual({ claimed: false, reason: "taken" });
  });

  it("стоп входов читается при каждом захвате; выключенный эксперимент не захватывается", async () => {
    await toggleOn("S98");
    const a = await newTrade("S98", "SOLUSDT");
    await liveHaltAction("stop", actor);
    expect(await claimLive(a)).toEqual({ claimed: false, reason: "halted" });
    await liveHaltAction("resume", actor);
    await setLiveMirror({ id: "S98", liveMirror: false }, actor);
    expect(await claimLive(a)).toEqual({ claimed: false, reason: "disabled" });
  });

  it("пропуск по дневному лимиту — Telegram один раз за сутки на эксперимент", async () => {
    await toggleOn("S98");
    vi.clearAllMocks();
    const a = await newTrade("S98", "XRPUSDT");
    const b = await newTrade("S98", "ADAUSDT");
    await skipLive(a, "дневной лимит убытка эксперимента: −$15,20 за сутки");
    await skipLive(b, "дневной лимит убытка эксперимента: −$15,20 за сутки");
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][2]).toMatch(
      /Дневной лимит убытка: S98/,
    );
    // Обычный пропуск — только журнал.
    await skipLive(
      await newTrade("S98", "DOTUSDT"),
      "по монете уже есть реальная позиция",
    );
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });
});

describe("вход, выход и дневной PnL", () => {
  it("вход → закрытие с PnL; PnL эксперимента за сутки в состоянии прогона и в карточке", async () => {
    await toggleOn("S98");
    const a = await newTrade("S98", "LINKUSDT");
    await claimLive(a);
    vi.clearAllMocks();
    await saveLiveOpen({
      tradeId: a,
      result: {
        id: "r1",
        status: "protected",
        message: "ok",
        entryPrice: 100,
        filledQuantity: 0.1,
        steps: [],
        protectRefs: null,
      },
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: false },
    });
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][2]).toMatch(
      /🟢 Реальная сделка: S98 LINKUSDT \(USDⓈ-M\) long \$10,00, SL 95, TP 110/,
    );
    let trading = await getLiveTradingView();
    expect(trading.positions).toHaveLength(1);

    await db
      .update(paperTradesTable)
      .set({ closedAt: new Date(), exitPrice: 90, exitReason: "stop" })
      .where(eq(paperTradesTable.id, a));
    expect((await liveMirrorState()).toClose).toEqual([a]);
    const item = await claimLiveClose(a);
    expect(item?.tradeId).toBe(a);
    await saveLiveClose({
      tradeId: a,
      status: "closed",
      exit: {
        message: "Позиция закрыта по рынку.",
        steps: [],
        exitPrice: 90,
        feesUsd: 0.1,
        realizedPnl: -16,
        closedBy: "mirror",
      },
    });
    expect((await getLiveMirror(db, a))?.status).toBe("closed");
    expect(vi.mocked(sendTelegramMessage).mock.calls[1][2]).toMatch(
      /🔴 Закрыта: S98 LINKUSDT .* −\$16,00 \(закрыта paper-сделка\)/,
    );
    expect((await liveMirrorState()).dailyPnl).toEqual({ S98: -16 });
    trading = await getLiveTradingView();
    expect(trading.experiments).toEqual([
      expect.objectContaining({ id: "S98", dailyPnl: -16, limitHit: true }),
    ]);
  });

  it("«Закрыть всё»: стоп входов, захват открытых, итог в журнал и Telegram", async () => {
    await toggleOn("S98");
    const a = await newTrade("S98", "BNBUSDT");
    await claimLive(a);
    await saveLiveOpen({
      tradeId: a,
      result: {
        id: "r2",
        status: "protected",
        message: "ok",
        entryPrice: 100,
        filledQuantity: 0.1,
        steps: [],
        protectRefs: null,
      },
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: false },
    });
    await liveHaltAction("close_all", actor);
    const state = await liveMirrorState();
    expect(state.halt).toEqual({ stopped: true, closeAllRequested: true });
    const items = await liveCloseAll({ phase: "claim" });
    expect(items.map((i) => i.tradeId)).toEqual([a]);
    await liveCloseAll({ phase: "done", closed: 1, failed: 0, errors: [] });
    const after = await getLiveTradingView();
    expect(after.halt).toMatchObject({
      stopped: true,
      closeAllRequestedAt: null,
      closeAllResult: { closed: 1, failed: 0, errors: [] },
    });
    expect((await liveMirrorState()).halt.closeAllRequested).toBe(false);
  });
});
