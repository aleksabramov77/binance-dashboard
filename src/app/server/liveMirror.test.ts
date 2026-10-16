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
  saveLiveReconcile,
  setLiveMode,
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
  setLiveMode({ id, mode: "on", confirm }, actor);

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
      mode: "on",
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
    expect(await setLiveMode({ id: "S98", mode: "off" }, actor)).toMatchObject({
      ok: true,
    });
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
    await setLiveMode({ id: "S98", mode: "off" }, actor);
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
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: null },
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
        leftover: null,
        pnlEstimated: false,
      },
      protectionRemoved: false,
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
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: null },
    });
    await liveHaltAction("close_all", actor);
    const state = await liveMirrorState();
    expect(state.halt).toEqual({ stopped: true, closeAllRequested: true });
    const items = await liveCloseAll({ phase: "claim" });
    expect(items.map((i) => i.tradeId)).toEqual([a]);
    await saveLiveClose({
      tradeId: a,
      status: "closed",
      exit: {
        message: "ok",
        steps: [],
        exitPrice: 101,
        feesUsd: 0,
        realizedPnl: 0.1,
        closedBy: "close_all",
        leftover: null,
        pnlEstimated: false,
      },
      protectionRemoved: false,
    });
    await liveCloseAll({ phase: "done", closed: 1, failed: 0, errors: [] });
    const after = await getLiveTradingView();
    expect(after.halt).toMatchObject({
      stopped: true,
      closeAllRequestedAt: null,
      closeAllResult: { closed: 1, failed: 0, errors: [], remaining: 0 },
    });
    expect((await liveMirrorState()).halt.closeAllRequested).toBe(false);
  });
});

describe("повтор закрытий (приёмка 0049)", () => {
  const openLive = async (symbol: string) => {
    await toggleOn("S98");
    const id = await newTrade("S98", symbol);
    await claimLive(id);
    await saveLiveOpen({
      tradeId: id,
      result: {
        id: `r-${id}`,
        status: "protected",
        message: "ok",
        entryPrice: 100,
        filledQuantity: 0.1,
        steps: [],
        protectRefs: null,
      },
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: null },
    });
    return id;
  };
  const exit = {
    message: "сеть",
    steps: [],
    exitPrice: null,
    feesUsd: null,
    realizedPnl: null,
    closedBy: null,
    leftover: null,
    pnlEstimated: false,
  };
  /** Пауза между повторами — по updated_at: «прошла минута». */
  const minuteLater = (id: string) =>
    db.execute(
      `update live_mirror_orders set updated_at = now() - interval '2 minutes' where trade_id = '${id}'`,
    );

  it("сбой закрытия → повтор на следующем прогоне → успех; Telegram о сбое один раз, итог — «после N попыток»", async () => {
    const a = await openLive("AVAXUSDT");
    await db
      .update(paperTradesTable)
      .set({ closedAt: new Date(), exitPrice: 110, exitReason: "takeProfit" })
      .where(eq(paperTradesTable.id, a));
    vi.clearAllMocks();
    expect(await claimLiveClose(a)).not.toBeNull();
    await saveLiveClose({
      tradeId: a,
      status: "failed",
      exit,
      protectionRemoved: false,
    });
    expect((await getLiveMirror(db, a))?.status).toBe("close_failed");
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    // Сразу — пауза; через минуту — снова в очереди.
    expect((await liveMirrorState()).toClose).not.toContain(a);
    await minuteLater(a);
    expect((await liveMirrorState()).toClose).toContain(a);
    expect(await claimLiveClose(a)).not.toBeNull();
    await saveLiveClose({
      tradeId: a,
      status: "failed",
      exit,
      protectionRemoved: false,
    });
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    await minuteLater(a);
    expect(await claimLiveClose(a)).not.toBeNull();
    await saveLiveClose({
      tradeId: a,
      status: "closed",
      exit: {
        ...exit,
        message: "Позиция закрыта по рынку.",
        exitPrice: 108,
        realizedPnl: 0.79,
        closedBy: "mirror",
        leftover: { qty: 0.00000986, asset: "AVAX", usd: 0.0003 },
      },
      protectionRemoved: false,
    });
    expect((await getLiveMirror(db, a))?.status).toBe("closed");
    expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
    const text = vi.mocked(sendTelegramMessage).mock.calls[1][2];
    expect(text).toMatch(/закрыта после 3 попыток/);
    expect(text).toMatch(
      /остаток 0\.00000986 AVAX ≈ \$0,00 на субсчёте, в PnL не входит/,
    );
    const exitLog = vi
      .mocked(log.info)
      .mock.calls.find((c) => c[0] === "live.exit");
    expect(exitLog?.[2]).toMatchObject({
      attempts: 3,
      leftover: { asset: "AVAX" },
    });
    const trading = await getLiveTradingView();
    expect(trading.recent[0]).toMatchObject({
      tradeId: a,
      leftoverQty: 0.00000986,
    });
  });

  it("защита снята, а выход не прошёл — «без защиты», ⚠️ в Telegram, повтор даже при открытой paper-сделке", async () => {
    const a = await openLive("DOGEUSDT");
    await liveHaltAction("close_all", actor);
    vi.clearAllMocks();
    expect(
      (await liveCloseAll({ phase: "claim" })).map((i) => i.tradeId),
    ).toContain(a);
    await saveLiveClose({
      tradeId: a,
      status: "failed",
      exit,
      protectionRemoved: true,
    });
    expect((await getLiveMirror(db, a))?.status).toBe("unprotected");
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][2]).toMatch(
      /без защиты.*Свои TP\/SL уже сняты/,
    );
    await minuteLater(a);
    expect((await liveMirrorState()).toClose).toContain(a);
  });

  it("«Закрыть всё» держится, пока позиции есть, и снимается, когда закрыто всё", async () => {
    const a = await openLive("TRXUSDT");
    await liveHaltAction("close_all", actor);
    expect(
      (await liveCloseAll({ phase: "claim" })).map((i) => i.tradeId),
    ).toEqual([a]);
    await saveLiveClose({
      tradeId: a,
      status: "failed",
      exit,
      protectionRemoved: false,
    });
    await liveCloseAll({
      phase: "done",
      closed: 0,
      failed: 1,
      errors: ["TRXUSDT: сеть"],
    });
    let trading = await getLiveTradingView();
    expect(trading.halt.closeAllRequestedAt).not.toBeNull();
    expect(trading.halt.closeAllResult).toMatchObject({
      remaining: 1,
      runs: 1,
    });
    expect((await liveMirrorState()).halt.closeAllRequested).toBe(true);
    // Следующий прогон: неудачная позиция снова захватывается и закрывается.
    expect(
      (await liveCloseAll({ phase: "claim" })).map((i) => i.tradeId),
    ).toEqual([a]);
    await saveLiveClose({
      tradeId: a,
      status: "closed",
      exit: { ...exit, message: "ok", realizedPnl: 0, closedBy: "close_all" },
      protectionRemoved: false,
    });
    await liveCloseAll({ phase: "done", closed: 1, failed: 0, errors: [] });
    trading = await getLiveTradingView();
    expect(trading.halt.closeAllRequestedAt).toBeNull();
    expect(trading.halt.closeAllResult).toMatchObject({
      remaining: 0,
      runs: 2,
    });
    expect(trading.halt.stopped).toBe(true);
  });

  it("строка «закрывается» дольше 5 минут (прогон оборвался) — снова в очереди", async () => {
    const a = await openLive("LTCUSDT");
    await liveHaltAction("close_all", actor);
    await liveCloseAll({ phase: "claim" });
    expect((await getLiveMirror(db, a))?.status).toBe("closing");
    await db.execute(
      `update live_mirror_orders set updated_at = now() - interval '6 minutes' where trade_id = '${a}'`,
    );
    expect((await liveMirrorState()).toClose).toContain(a);
  });
  it("повторная неудача после снятия защиты — остаётся «без защиты», а не close_failed", async () => {
    const a = await openLive("ADAUSDT");
    await liveHaltAction("close_all", actor);
    await liveCloseAll({ phase: "claim" });
    await saveLiveClose({
      tradeId: a,
      status: "failed",
      exit,
      protectionRemoved: true,
    });
    expect((await getLiveMirror(db, a))?.status).toBe("unprotected");
    await minuteLater(a);
    expect(
      (await liveCloseAll({ phase: "claim" })).map((i) => i.tradeId),
    ).toContain(a);
    await saveLiveClose({
      tradeId: a,
      status: "failed",
      exit,
      protectionRemoved: false,
    });
    expect((await getLiveMirror(db, a))?.status).toBe("unprotected");
  });

  it("«Возобновить» во время «Закрыть всё» — 409, стоп входов остаётся", async () => {
    await openLive("XRPUSDT");
    await liveHaltAction("close_all", actor);
    const r = await liveHaltAction("resume", actor);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((await liveMirrorState()).halt).toMatchObject({
      stopped: true,
      closeAllRequested: true,
    });
  });
});

describe("сверка «потерянного» входа (ревью PR #89)", () => {
  const pendingFor = async (symbol: string) => {
    await toggleOn("S98");
    const id = await newTrade("S98", symbol);
    expect((await claimLive(id)).claimed).toBe(true);
    return id;
  };
  const age = (id: string, minutes: number) =>
    db.execute(
      `update live_mirror_orders set created_at = now() - interval '${minutes} minutes' where trade_id = '${id}'`,
    );

  it("pending дольше 3 минут — в stalePending; свежий — нет", async () => {
    const a = await pendingFor("ETHUSDT");
    expect((await liveMirrorState()).stalePending).toEqual([]);
    await age(a, 4);
    expect((await liveMirrorState()).stalePending).toMatchObject([
      { tradeId: a, symbol: "ETHUSDT", market: "usdm" },
    ]);
  });

  it("ордер найден со стопом — открытая позиция с уровнями; повтор итога не меняет строку", async () => {
    const a = await pendingFor("BNBUSDT");
    await age(a, 4);
    const body = {
      tradeId: a,
      outcome: "open" as const,
      message: "Вход найден на бирже по своему ордеру, свой стоп стоит.",
      entryPrice: 100,
      quantity: 0.1,
      protectRefs: null,
      stopLoss: null,
    };
    await saveLiveReconcile(body);
    const row = await getLiveMirror(db, a);
    expect(row).toMatchObject({ status: "protected", entryPrice: 100 });
    expect((await liveMirrorState()).stalePending).toEqual([]);
    await saveLiveReconcile({ ...body, outcome: "skipped" });
    expect((await getLiveMirror(db, a))?.status).toBe("protected");
  });

  it("ордер найден без стопа — «без защиты», ⚠️ в Telegram, позиция в очереди закрытия", async () => {
    const a = await pendingFor("SOLUSDT");
    await age(a, 4);
    vi.clearAllMocks();
    await saveLiveReconcile({
      tradeId: a,
      outcome: "unprotected",
      message: "Вход найден на бирже, своего стопа нет.",
      entryPrice: 100,
      quantity: 0.1,
      protectRefs: null,
      stopLoss: null,
    });
    expect((await getLiveMirror(db, a))?.status).toBe("unprotected");
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][2]).toMatch(/⚠️/);
    // Как после неудачного закрытия: пауза между повторами, затем — в очереди закрытия каждый прогон.
    await db.execute(
      `update live_mirror_orders set updated_at = now() - interval '2 minutes' where trade_id = '${a}'`,
    );
    expect((await liveMirrorState()).toClose).toContain(a);
  });

  it("ордера нет — пропуск с причиной; «Закрыть всё» больше не ждёт эту строку", async () => {
    const a = await pendingFor("DOTUSDT");
    await age(a, 4);
    await liveHaltAction("close_all", actor);
    await saveLiveReconcile({
      tradeId: a,
      outcome: "skipped",
      message: "Вход не состоялся: своего ордера входа на бирже нет.",
      entryPrice: null,
      quantity: null,
      protectRefs: null,
      stopLoss: null,
    });
    expect(await getLiveMirror(db, a)).toMatchObject({
      status: "skipped",
      message: expect.stringMatching(/Вход не состоялся/),
    });
    expect(await liveCloseAll({ phase: "claim" })).toEqual([]);
    await liveCloseAll({ phase: "done", closed: 0, failed: 0, errors: [] });
    expect((await getLiveTradingView()).halt.closeAllRequestedAt).toBeNull();
  });
});

describe("PnL — оценка (исполнения не прочитаны)", () => {
  it("оценка идёт в дневной PnL, помечена в карточке и в Telegram", async () => {
    await toggleOn("S98");
    const id = await newTrade("S98", "LINKUSDT");
    await claimLive(id);
    await saveLiveOpen({
      tradeId: id,
      result: {
        id: `r-${id}`,
        status: "protected",
        message: "ok",
        entryPrice: 100,
        filledQuantity: 0.1,
        steps: [],
        protectRefs: null,
      },
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: null },
    });
    await db
      .update(paperTradesTable)
      .set({ closedAt: new Date(), exitPrice: 95, exitReason: "stop" })
      .where(eq(paperTradesTable.id, id));
    expect(await claimLiveClose(id)).not.toBeNull();
    vi.clearAllMocks();
    await saveLiveClose({
      tradeId: id,
      status: "closed",
      protectionRemoved: false,
      exit: {
        message:
          "Позиция закрыта по рынку. PnL — оценка по ценам входа и выхода, комиссия по ставке.",
        steps: [],
        exitPrice: 95,
        feesUsd: 0.01,
        realizedPnl: -0.51,
        pnlEstimated: true,
        leftover: null,
        closedBy: "mirror",
      },
    });
    expect((await liveMirrorState()).dailyPnl.S98).toBeCloseTo(-0.51);
    const trading = await getLiveTradingView();
    expect(trading.recent[0]).toMatchObject({
      tradeId: id,
      realizedPnl: -0.51,
      pnlEstimated: true,
    });
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][2]).toMatch(
      /≈.*\(оценка\)/,
    );
  });
});

describe("итог входа доставлен дважды (ревью PR #89, круг 2)", () => {
  it("второй вызов не пишет журнал и не шлёт Telegram; свой стоп сохранён для оценки PnL", async () => {
    await toggleOn("S98");
    const id = await newTrade("S98", "ATOMUSDT");
    await claimLive(id);
    const body = {
      tradeId: id,
      result: {
        id: `r-${id}`,
        status: "protected" as const,
        message: "ok",
        entryPrice: 100,
        filledQuantity: 0.1,
        steps: [],
        protectRefs: null,
      },
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: null },
    };
    vi.clearAllMocks();
    await saveLiveOpen(body);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    const entries = () =>
      vi.mocked(log.info).mock.calls.filter((c) => c[0] === "live.entry");
    expect(entries()).toHaveLength(1);
    // Ответ потерялся по таймауту — воркер прислал тот же итог ещё раз; или outbox после сверки — уже «без защиты».
    await saveLiveOpen(body);
    await saveLiveOpen({
      ...body,
      result: { ...body.result, status: "unprotected" },
    });
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(entries()).toHaveLength(1);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
    expect((await getLiveMirror(db, id))?.status).toBe("protected");

    await liveHaltAction("close_all", actor);
    const [claimed] = (await liveCloseAll({ phase: "claim" })).filter(
      (i) => i.tradeId === id,
    );
    expect(claimed).toMatchObject({ stopLoss: 95, entryPrice: 100 });
  });
});
