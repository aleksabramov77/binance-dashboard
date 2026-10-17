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
import {
  liveWorkerStateTable,
  saveLiveState,
  setLiveStopped,
} from "@/entities/live-account";
import { telegramMessageText } from "@/shared/api/telegram";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { log, setNotifyChannels } from "@/shared/lib/logger.server";
import type { NotifyChannel } from "@/shared/notify";
import { runLiveAuto } from "./liveAuto";
import {
  claimLive,
  claimLiveClose,
  saveLiveClose,
  saveLiveLegs,
  saveLiveOpen,
  setLiveMode,
} from "./liveMirror";

// Режимы реального счёта (spec 0053) без биржи: SQLite в памяти, канал уведомлений — мок. Id — фиктивные (S96–S98, PS99).
let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
vi.mock("./tickerPrices", () => ({
  cachedTickerPrices: vi.fn(async () => new Map()),
}));
// Журнал — моки, уведомление — настоящий log.notify с фиктивным каналом (spec 0067): Telegram не вызывается.
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
  deliver: vi.fn<NotifyChannel["deliver"]>(async () => ({ status: "sent" })),
};
/** Тексты, которые получил канал (текст + ссылка — как в Telegram). */
const sent = () =>
  channel.deliver.mock.calls.map(([n]) => telegramMessageText(n));
/** Записи с уведомлением: событие, категория и звук. */
const notices = () =>
  vi.mocked(log.notify).mock.calls.map(([n]) => ({
    event: n.event,
    category: n.category,
    urgent: n.urgent ?? false,
    skip: n.skip,
  }));
/** Данные записи с уведомлением по событию. */
const noticeData = (event: string) =>
  vi.mocked(log.notify).mock.calls.find(([n]) => n.event === event)?.[0].data;

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

let runId: number;
let n = 0;
const paper = (
  id: string,
  experimentId: string,
  symbol: string,
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market: experimentId === "PS99" ? "spot" : "usdm",
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
const newTrade = async (experimentId: string) => {
  const id = `t${++n}`;
  await createDbExperimentStore(db).insertTrade(
    paper(id, experimentId, `C${n}USDT`),
  );
  return id;
};

const actor = { by: "tester", authEnabled: true };
const okPulse = () =>
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

/** Реальная сделка эксперимента: вход (стоп 95, 0.1 по 100) → закрытие с этим PnL (null — PnL неизвестен). */
async function liveTrade(experimentId: string, pnl: number | null) {
  const id = await newTrade(experimentId);
  expect((await claimLive(id)).claimed).toBe(true);
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
    .set({ closedAt: new Date(), exitPrice: 99, exitReason: "stop" })
    .where(eq(paperTradesTable.id, id));
  expect(await claimLiveClose(id)).not.toBeNull();
  await saveLiveClose({
    tradeId: id,
    status: "closed",
    protectionRemoved: false,
    exit: {
      message: "Позиция закрыта по рынку.",
      steps: [],
      exitPrice: 99,
      feesUsd: 0.01,
      realizedPnl: pnl,
      pnlEstimated: false,
      leftover: null,
      closedBy: "mirror",
    },
  });
  return id;
}

/** Закрытая демо-сделка с этим R: вход 100, исходный стоп paper-сделки 95 (риск 5). */
async function demoTrade(experimentId: string, r: number) {
  const id = await newTrade(experimentId);
  const exit = 100 + 5 * r;
  await db
    .update(paperTradesTable)
    .set({ closedAt: new Date(), exitPrice: exit, exitReason: "takeProfit" })
    .where(eq(paperTradesTable.id, id));
  db.run(
    `insert into demo_mirror_orders (trade_id, experiment_id, market, symbol, direction, status, entry_price, quantity, exit_price, closed_at)
     values ('${id}', '${experimentId}', 'usdm', 'C${n}USDT', 'long', 'closed', 100, 1, ${exit}, ${Date.now()})`,
  );
}
const demoTrades = async (experimentId: string, rs: number[]) => {
  for (const r of rs) await demoTrade(experimentId, r);
};

const experiment = async (id: string) => {
  const [row] = await db
    .select()
    .from(experimentsTable)
    .where(eq(experimentsTable.id, id));
  return row;
};
const telegramTexts = sent;
const logEvents = (level: "info" | "warn") =>
  vi.mocked(log[level]).mock.calls.map((c) => c[0]);

beforeAll(async () => {
  ({ db, close } = await createMemoryDb());
  await seedExperiments(db, [
    exp("S96", "usdm"),
    exp("S97", "usdm"),
    exp("S98", "usdm"),
    exp("PS99", "spot"),
    exp("PC99", "coinm"),
  ]);
  runId = await ensureRun(db);
}, 60_000);
afterAll(() => close());

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot");
  vi.stubEnv("TELEGRAM_CHAT_ID", "42");
  await db.delete(liveWorkerStateTable);
  db.run("delete from live_mirror_orders");
  db.run("delete from demo_mirror_orders");
  db.run("delete from live_trading_halt");
  await db.update(experimentsTable).set({
    liveMirror: false,
    liveMirrorMode: "off",
    liveMirrorSince: null,
    liveLossLimitUsd: 15,
    liveLossStreak: 5,
    liveAutoOffAt: null,
    liveAutoOffReason: null,
    liveMirrorAdvice: null,
    liveMirrorAuto: null,
    demoMirror: true,
    demoMirrorSince: null,
    enabled: true,
  });
  await okPulse();
  vi.clearAllMocks();
  channel.deliver.mockImplementation(async () => ({ status: "sent" }));
  setNotifyChannels([channel]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  setNotifyChannels([]);
});

const mode = (
  id: string,
  m: "off" | "auto" | "on" | "on_autooff",
  thresholds?: { lossUsd: number; streak: number },
) => setLiveMode({ id, mode: m, confirm: "РЕАЛ", thresholds }, actor);

describe("переключатель на четыре положения (AC1, AC2)", () => {
  it("«Вкл + автовыкл» — пороги сохраняются; без слова или для COIN-M — нельзя; «Выкл» — сразу", async () => {
    expect(
      await setLiveMode({ id: "S97", mode: "on_autooff" }, actor),
    ).toMatchObject({ ok: false, status: 400 });
    expect(await mode("PC99", "auto")).toMatchObject({ ok: false });
    expect(await mode("S97", "on_autooff", { lossUsd: 10, streak: 5 })).toEqual(
      { ok: true, id: "S97", mode: "on_autooff", liveMirror: true },
    );
    expect(await experiment("S97")).toMatchObject({
      liveMirrorMode: "on_autooff",
      liveMirror: true,
      liveLossLimitUsd: 10,
      liveLossStreak: 5,
    });
    expect(telegramTexts()[0]).toMatch(
      /S97 .*Вкл \+ автовыкл.*порог \$10 или 5 убыточных сделок подряд/,
    );
    expect(await mode("S97", "off")).toMatchObject({
      ok: true,
      liveMirror: false,
    });
  });

  it("ключ не «✅» — включить нельзя ни в одном режиме", async () => {
    await db.delete(liveWorkerStateTable);
    for (const m of ["auto", "on", "on_autooff"] as const)
      expect(await mode("S98", m)).toMatchObject({ ok: false, status: 409 });
  });

  it("активный режим — меняются только пороги: флаг и окно не трогаются", async () => {
    await mode("S97", "on_autooff", { lossUsd: 10, streak: 5 });
    const before = await experiment("S97");
    expect(
      await mode("S97", "on_autooff", { lossUsd: 20, streak: 3 }),
    ).toMatchObject({ ok: true, liveMirror: true });
    const after = await experiment("S97");
    expect(after).toMatchObject({ liveLossLimitUsd: 20, liveLossStreak: 3 });
    expect(after.liveMirrorSince).toEqual(before.liveMirrorSince);
  });

  it("порог опустили ниже набранного убытка — «Выкл» сразу, а не при следующем закрытии (ревью PR #95)", async () => {
    await mode("S97", "on_autooff", { lossUsd: 20, streak: 5 });
    await liveTrade("S97", -6);
    await liveTrade("S97", -4.4);
    expect((await experiment("S97")).liveMirror).toBe(true);
    expect(
      await mode("S97", "on_autooff", { lossUsd: 10, streak: 5 }),
    ).toMatchObject({ ok: true, liveMirror: false });
    expect(await experiment("S97")).toMatchObject({
      liveMirrorMode: "off",
      liveAutoOffReason: "убыток −$10,40 ≥ порога $10",
    });
  });
});

describe("автовыключение по порогам при закрытии (AC3)", () => {
  it("«Вкл + автовыкл»: −$10,40 при пороге $10 → «Выкл» с причиной, live.auto и уведомление со звуком; открытая позиция доживает", async () => {
    await mode("S97", "on_autooff", { lossUsd: 10, streak: 5 });
    const open = await newTrade("S97");
    await claimLive(open);
    await liveTrade("S97", -6);
    expect((await experiment("S97")).liveMirror).toBe(true);
    vi.clearAllMocks();
    await liveTrade("S97", -4.4);
    const e = await experiment("S97");
    expect(e).toMatchObject({
      liveMirrorMode: "off",
      liveMirror: false,
      liveAutoOffReason: "убыток −$10,40 ≥ порога $10",
      liveMirrorBy: "автомат",
    });
    expect(e.liveAutoOffAt).not.toBeNull();
    expect(telegramTexts().at(-1)).toMatch(
      /⛔ S97 → реальный счёт выключен \(Вкл \+ автовыкл\): убыток −\$10,40 ≥ порога \$10/,
    );
    expect(noticeData("live.auto")).toMatchObject({
      experimentId: "S97",
      mode: "on_autooff",
      decision: "disable_loss",
      pnlUsd: -10.4,
    });
    expect(notices().find((n) => n.event === "live.auto")).toMatchObject({
      category: "trades",
      urgent: true,
    });
    // Захваченная до выключения позиция не закрывается.
    expect((await getLiveMirror(db, open))?.status).toBe("pending");
  });

  it("«Авто»: 5 убыточных подряд → «Выкл»; повтор итога закрытия ничего не шлёт", async () => {
    await db
      .update(experimentsTable)
      .set({
        liveMirrorMode: "auto",
        liveMirror: true,
        liveMirrorSince: new Date(Date.now() - 1000),
      })
      .where(eq(experimentsTable.id, "S98"));
    for (let i = 0; i < 4; i++) await liveTrade("S98", -0.2);
    expect((await experiment("S98")).liveMirror).toBe(true);
    const last = await liveTrade("S98", -0.2);
    expect(await experiment("S98")).toMatchObject({
      liveMirrorMode: "off",
      liveAutoOffReason: "5 убыточных сделок подряд",
    });
    expect(telegramTexts().at(-1)).toMatch(
      /⛔ S98 → реальный счёт выключен \(Авто\): 5 убыточных сделок подряд/,
    );
    vi.clearAllMocks();
    await saveLiveClose({
      tradeId: last,
      status: "closed",
      protectionRemoved: false,
      exit: {
        message: "повтор",
        steps: [],
        exitPrice: 99,
        feesUsd: 0,
        realizedPnl: -0.2,
        pnlEstimated: false,
        leftover: null,
        closedBy: "mirror",
      },
    });
    expect(channel.deliver).not.toHaveBeenCalled();
  });

  it("сделки до включения не считаются; прибыльная обрывает серию", async () => {
    await mode("S97", "on_autooff", { lossUsd: 100, streak: 3 });
    await liveTrade("S97", -1);
    await liveTrade("S97", -1);
    await mode("S97", "on_autooff", { lossUsd: 100, streak: 3 }); // пороги — окно то же
    await mode("S97", "off");
    await mode("S97", "on_autooff", { lossUsd: 100, streak: 3 }); // новое окно
    await liveTrade("S97", -1);
    await liveTrade("S97", 0.5);
    await liveTrade("S97", -1);
    expect((await experiment("S97")).liveMirror).toBe(true);
  });

  it("закрытие биржей (сверка ног) тоже проверяет пороги", async () => {
    await mode("S97", "on_autooff", { lossUsd: 1, streak: 50 });
    const id = await newTrade("S97");
    await claimLive(id);
    await saveLiveOpen({
      tradeId: id,
      result: {
        id: "r",
        status: "protected",
        message: "ok",
        entryPrice: 100,
        filledQuantity: 0.1,
        steps: [],
        protectRefs: null,
      },
      order: { stopLoss: 95, takeProfit: 110, notionalUsd: 10, raised: null },
    });
    await saveLiveLegs({
      items: [
        {
          tradeId: id,
          outcome: "closed",
          exit: {
            message: "стоп",
            steps: [],
            exitPrice: 95,
            feesUsd: 0.01,
            realizedPnl: -1.2,
            pnlEstimated: false,
            leftover: null,
            closedBy: "sl",
          },
        },
      ],
    });
    expect((await experiment("S97")).liveMirrorMode).toBe("off");
  });

  it("PnL неизвестен: в серии — убыток, в сумме — по своему стопу; пометка в Telegram и live.advice", async () => {
    await mode("S97", "on_autooff", { lossUsd: 1, streak: 50 });
    await liveTrade("S97", -0.4);
    expect((await experiment("S97")).liveMirror).toBe(true);
    vi.clearAllMocks();
    // Стоп 95 при входе 100 × 0.1 → −$0,50; вместе с −$0,40 — −$0,90 < $1: ещё включён.
    await liveTrade("S97", null);
    expect((await experiment("S97")).liveMirror).toBe(true);
    expect(telegramTexts().some((t) => /PnL \?/.test(t))).toBe(true);
    expect(logEvents("warn")).toContain("live.advice");
    // Итог сделки — карточка со звуком (spec 0068, вариант B).
    expect(notices().find((n) => n.event === "live.exit")?.urgent).toBe(true);
    await liveTrade("S97", -0.2);
    expect(await experiment("S97")).toMatchObject({
      liveMirrorMode: "off",
      liveAutoOffReason: "убыток −$1,10 ≥ порога $1",
    });
  });

  it("сбой канала уведомлений не отменяет выключение (AC10)", async () => {
    channel.deliver.mockRejectedValue(new Error("telegram"));
    await mode("S97", "on_autooff", { lossUsd: 1, streak: 50 });
    await liveTrade("S97", -2);
    expect((await experiment("S97")).liveMirrorMode).toBe("off");
  });
});

describe("ручное «Вкл»: только подсказка (AC6)", () => {
  it("5 убытков подряд — «Вкл» остаётся, одна подсказка; следующий убыток — без повтора", async () => {
    await mode("S96", "on");
    for (let i = 0; i < 4; i++) await liveTrade("S96", -0.1);
    vi.clearAllMocks();
    await liveTrade("S96", -0.1);
    expect(await experiment("S96")).toMatchObject({
      liveMirrorMode: "on",
      liveMirror: true,
      liveMirrorAdvice: "streak",
    });
    const advice = telegramTexts().filter((t) => t.includes("включён вручную"));
    // Подсказка — тихо.
    expect(notices().find((n) => n.event === "live.advice")?.urgent).toBe(
      false,
    );
    expect(advice).toEqual([
      expect.stringContaining(
        "⚠️ S96 — реальный счёт включён вручную: 5 убыточных сделок подряд. Вкл + автовыкл бы выключил",
      ),
    ]);
    vi.clearAllMocks();
    await liveTrade("S96", -0.1);
    expect(
      telegramTexts().filter((t) => t.includes("включён вручную")),
    ).toEqual([]);
    // Суточная проверка тоже не повторяет и не выключает.
    const r = await runLiveAuto();
    expect(r.advice).toEqual([]);
    expect((await experiment("S96")).liveMirror).toBe(true);
  });
});

describe("«Авто» по демо — суточная проверка и перевод в «Авто» (AC4, AC7, AC10)", () => {
  it("мало демо-сделок — ждёт N из 30; демо-зеркало выкл и сделок нет — 0 из 30", async () => {
    await demoTrades("S98", Array(12).fill(1));
    expect(await mode("S98", "auto")).toMatchObject({
      ok: true,
      liveMirror: false,
    });
    expect((await experiment("S98")).liveMirrorAuto).toMatchObject({
      decision: "wait",
      demoTrades: 12,
      demoMirror: true,
    });
    await db
      .update(experimentsTable)
      .set({ demoMirror: false })
      .where(eq(experimentsTable.id, "S96"));
    await mode("S96", "auto");
    expect((await experiment("S96")).liveMirrorAuto).toMatchObject({
      decision: "wait",
      demoTrades: 0,
      demoMirror: false,
    });
  });

  it("перевод в «Авто» с ≥ 30 демо-сделками и средним R > 0 — сразу включает; уведомление 🤖 со звуком", async () => {
    await demoTrades("S98", [...Array(16).fill(1), ...Array(15).fill(-0.8)]);
    expect(await mode("S98", "auto")).toMatchObject({
      ok: true,
      liveMirror: true,
    });
    expect(await experiment("S98")).toMatchObject({
      liveMirrorMode: "auto",
      liveMirror: true,
      liveMirrorBy: "автомат",
    });
    expect(telegramTexts().at(-1)).toMatch(
      /🤖 S98 → реальный счёт включён \(Авто\): 31 демо-сделка, средний R \+0,13/,
    );
    expect(noticeData("live.auto")).toMatchObject({
      experimentId: "S98",
      mode: "auto",
      decision: "enable",
      demoTrades: 31,
    });
    expect(notices().find((n) => n.event === "live.auto")?.urgent).toBe(true);
  });

  it("стоп входов: автовключение помечено «торговли не будет до «Возобновить»» (AC7)", async () => {
    await setLiveStopped(db, true, "tester");
    await demoTrades("S98", Array(30).fill(0.5));
    await mode("S98", "auto");
    expect((await experiment("S98")).liveMirror).toBe(true);
    expect(telegramTexts().at(-1)).toMatch(
      /входы остановлены — торговли не будет до «Возобновить»/,
    );
  });

  it("суточная: «Авто» включён, средний R последних 30 демо < 0 → «Выкл» с причиной", async () => {
    await db
      .update(experimentsTable)
      .set({
        liveMirrorMode: "auto",
        liveMirror: true,
        liveMirrorSince: new Date(),
      })
      .where(eq(experimentsTable.id, "S98"));
    await demoTrades("S98", [...Array(10).fill(3), ...Array(30).fill(-0.1)]);
    const r = await runLiveAuto();
    expect(r.changes).toEqual([
      expect.objectContaining({
        id: "S98",
        change: "disable",
        decision: "disable_demo",
      }),
    ]);
    expect(await experiment("S98")).toMatchObject({
      liveMirrorMode: "off",
      liveMirror: false,
      liveAutoOffReason: "средний R последних 30 демо-сделок −0,10 < 0",
    });
    // «Выкл» после автовыключения автомат больше не трогает.
    await demoTrades("S98", Array(40).fill(2));
    expect((await runLiveAuto()).checked).toBe(0);
    expect((await experiment("S98")).liveMirror).toBe(false);
  });

  it("dryRun — тот же план без записи и уведомлений; ручные «Вкл» и «Выкл» не меняются", async () => {
    await db
      .update(experimentsTable)
      .set({ liveMirrorMode: "auto" })
      .where(eq(experimentsTable.id, "S98"));
    await mode("S96", "on");
    vi.clearAllMocks();
    await demoTrades("S98", Array(30).fill(1));
    await demoTrades("S96", Array(30).fill(-1));
    await demoTrades("S97", Array(30).fill(1));
    const dry = await runLiveAuto({ dryRun: true });
    expect(dry.changes.map((c) => c.id)).toEqual(["S98"]);
    expect((await experiment("S98")).liveMirror).toBe(false);
    expect(channel.deliver).not.toHaveBeenCalled();
    await runLiveAuto();
    expect((await experiment("S98")).liveMirror).toBe(true);
    expect((await experiment("S96")).liveMirror).toBe(true);
    expect((await experiment("S97")).liveMirror).toBe(false);
  });
});
