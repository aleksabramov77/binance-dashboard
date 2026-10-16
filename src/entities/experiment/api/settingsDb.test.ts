import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { experimentsTable, paperTradesTable, runsTable } from "../model/db";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import {
  getEpoch,
  type ResetRunInput,
  resetExperimentRun,
  resetGroupRun,
  resetRun,
  setDisableReason,
  setExperimentEnabled,
} from "./settingsDb";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

const exp = (id: string): Experiment => ({
  id,
  market: "usdm",
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

const trade = (id: string, runId: number, closed = false): PaperTrade => ({
  id,
  runId,
  experimentId: "F01",
  market: "usdm",
  symbol: "BTCUSDT",
  direction: "long",
  openedAt: "2026-10-10T10:00:00.000Z",
  entryPrice: 100,
  quantity: 1,
  initialStop: 98,
  stop: 98,
  takeProfit: 104,
  atr: 1,
  extreme: 100,
  checkedUntil: 0,
  closedAt: closed ? "2026-10-10T11:00:00.000Z" : null,
  exitPrice: closed ? 104 : null,
  exitReason: closed ? "tp" : null,
  fees: 0.1,
  pnl: closed ? 3.9 : null,
  rMultiple: closed ? 1.95 : null,
  demoOrderRef: null,
  mae: null,
  entryContext: {},
  signal: { bar: 1 },
});

const CLOSED_AT = "2026-10-10T12:00:00.000Z";
const manual = (pnl: number, exitPrice: number) => ({
  closedAt: CLOSED_AT,
  exitPrice,
  exitReason: "manual" as const,
  fees: 0.2,
  pnl,
  rMultiple: pnl / 2,
});

async function setup() {
  await seedExperiments(db, [exp("F01"), exp("F02")]);
  const runId = await ensureRun(db);
  const store = createDbExperimentStore(db);
  await store.insertTrade(trade("open-1", runId));
  await store.insertTrade(trade("open-2", runId));
  await store.insertTrade(trade("done", runId, true));
  return { runId, store };
}

const input = (fromRunId: number): ResetRunInput => ({
  fromRunId,
  note: "после правки стопов",
  closes: [
    { id: "open-1", close: manual(5, 105), noPrice: false },
    { id: "open-2", close: manual(0, 100), noPrice: true },
  ],
  state: { bars: { F01: 123 } },
  initialBudget: 20_000,
});

describe("сброс тестовых капиталов (PGlite)", () => {
  it("закрывает открытые сделки эпохи по плану (manual) и помечает закрытые без цены", async () => {
    const { runId } = await setup();
    const out = await resetRun(db, input(runId));
    expect(out).toEqual({
      created: true,
      runId: runId + 1,
      closed: 2,
      closedWithoutPrice: 1,
    });
    const rows = await db
      .select()
      .from(paperTradesTable)
      .orderBy(paperTradesTable.id);
    expect(rows.map((r) => [r.id, r.runId, r.exitReason])).toEqual([
      ["done", runId, "tp"],
      ["open-1", runId, "manual"],
      ["open-2", runId, "manual"],
    ]);
    const open1 = rows.find((r) => r.id === "open-1");
    const open2 = rows.find((r) => r.id === "open-2");
    expect(open1?.pnl).toBe(5);
    expect(open1?.closedAt?.toISOString()).toBe(CLOSED_AT);
    expect(open1?.signal).toEqual({ bar: 1 });
    expect(open2?.signal).toEqual({ bar: 1, resetWithoutPrice: true });
  });

  it("новая эпоха — текущая, с заметкой; её бюджеты с нуля: нет сделок и PnL", async () => {
    const { runId, store } = await setup();
    await resetRun(db, input(runId));
    const current = await store.currentRunId();
    expect(current).toBe(runId + 1);
    expect(await store.openTrades(current)).toEqual([]);
    expect(await store.realizedPnl(current)).toEqual({});
    // Старая эпоха сохранила свои сделки и PnL.
    expect(await store.realizedPnl(runId)).toEqual({ F01: 3.9 + 5 + 0 });
    expect(await getEpoch(db, current)).toMatchObject({
      id: current,
      note: "после правки стопов",
      trades: 0,
      openTrades: 0,
    });
  });

  it("пишет метки свечей и новый стартовый бюджет всем экспериментам", async () => {
    const { runId, store } = await setup();
    await resetRun(db, input(runId));
    expect(await store.getState("bars")).toEqual({ F01: 123 });
    const budgets = (await store.listExperiments()).map((e) => e.initialBudget);
    expect(budgets).toEqual([20_000, 20_000]);
  });

  it("без бюджета — бюджеты экспериментов не меняются", async () => {
    const { runId, store } = await setup();
    await resetRun(db, { ...input(runId), initialBudget: undefined });
    const budgets = (await store.listExperiments()).map((e) => e.initialBudget);
    expect(budgets).toEqual([10_000, 10_000]);
  });

  it("идемпотентность: повтор с той же fromRunId не создаёт вторую эпоху", async () => {
    const { runId } = await setup();
    const first = await resetRun(db, input(runId));
    const again = await resetRun(db, input(runId));
    expect(again).toEqual({ created: false, runId: first.runId });
    expect(await db.select().from(runsTable)).toHaveLength(2);
  });

  it("параллельные сбросы одной эпохи: новая эпоха одна", async () => {
    const { runId } = await setup();
    const outs = await Promise.all([
      resetRun(db, input(runId)),
      resetRun(db, input(runId)),
    ]);
    expect(outs.filter((o) => o.created)).toHaveLength(1);
    expect(await db.select().from(runsTable)).toHaveLength(2);
  });

  it("уже закрытую сделку план не перезаписывает", async () => {
    const { runId } = await setup();
    await resetRun(db, {
      ...input(runId),
      closes: [{ id: "done", close: manual(-100, 50), noPrice: false }],
    });
    const [done] = await db
      .select()
      .from(paperTradesTable)
      .where(eq(paperTradesTable.id, "done"));
    expect(done.exitReason).toBe("tp");
    expect(done.pnl).toBe(3.9);
  });
});

describe("эпоха и тумблеры", () => {
  it("getEpoch считает сделки и открытые", async () => {
    const { runId } = await setup();
    expect(await getEpoch(db, runId)).toMatchObject({
      id: runId,
      note: "Первая эпоха",
      trades: 3,
      openTrades: 2,
    });
  });

  it("setExperimentEnabled меняет флаг; неизвестный id — false", async () => {
    await seedExperiments(db, [exp("F01")]);
    const off = { enabled: false, reason: "loser" } as const;
    expect(await setExperimentEnabled(db, "F01", off)).toBe(true);
    expect(await setExperimentEnabled(db, "NOPE", off)).toBe(false);
    const [row] = await db
      .select()
      .from(experimentsTable)
      .where(eq(experimentsTable.id, "F01"));
    expect(row.enabled).toBe(false);
  });

  it("выключение пишет причину и время, включение очищает (spec 0046)", async () => {
    await seedExperiments(db, [exp("F96")]);
    const row = async () =>
      (
        await db
          .select()
          .from(experimentsTable)
          .where(eq(experimentsTable.id, "F96"))
      )[0];
    await setExperimentEnabled(db, "F96", {
      enabled: false,
      reason: "costs",
      note: "  комиссии съели плюс  ",
    });
    const off = await row();
    expect(off).toMatchObject({
      enabled: false,
      disabledReason: "costs",
      disabledNote: "комиссии съели плюс",
    });
    expect(off.disabledAt).toBeInstanceOf(Date);

    // Повторная причина — новая категория и текст, дата прежняя; у включённого — не пишется.
    expect(
      await setDisableReason(db, "F96", { reason: "loser", note: "" }),
    ).toBe(true);
    expect(await row()).toMatchObject({
      disabledReason: "loser",
      disabledNote: null,
      disabledAt: off.disabledAt,
    });

    await setExperimentEnabled(db, "F96", { enabled: true });
    expect(await row()).toMatchObject({
      enabled: true,
      disabledReason: null,
      disabledNote: null,
      disabledAt: null,
    });
    expect(await setDisableReason(db, "F96", { reason: "loser" })).toBe(false);
  });
});

describe("отдельный сброс paper-капитала эксперимента", () => {
  it("закрывает его сделки, обнуляет учёт и ставит метку свечи; эпоха та же", async () => {
    const { runId, store } = await setup();
    await store.setState("bars", { F01: 1, F02: 2 });
    expect(await store.realizedPnl(runId)).toEqual({ F01: 3.9 });

    const r = await resetExperimentRun(db, {
      runId,
      experimentId: "F01",
      closes: [{ id: "open-1", close: manual(5, 105), noPrice: false }],
      bar: 777,
      barsKey: "bars",
    });
    expect(r).toEqual({ found: true, closed: 1, closedWithoutPrice: 0 });
    expect(await store.currentRunId()).toBe(runId);
    // Сделки до сброса в учёт не идут: PnL эксперимента с нуля.
    expect(await store.realizedPnl(runId)).toEqual({});
    expect(await store.getState("bars")).toEqual({ F01: 777, F02: 2 });

    const later = {
      ...trade("after", runId, true),
      openedAt: new Date(Date.now() + 60_000).toISOString(),
      closedAt: new Date(Date.now() + 120_000).toISOString(),
    };
    await store.insertTrade(later);
    expect(await store.realizedPnl(runId)).toEqual({ F01: 3.9 });
  });

  it("неизвестный эксперимент — found: false", async () => {
    const { runId } = await setup();
    expect(
      await resetExperimentRun(db, {
        runId,
        experimentId: "nope",
        closes: [],
        barsKey: "bars",
      }),
    ).toEqual({ found: false, closed: 0, closedWithoutPrice: 0 });
  });
});

describe("сброс Paper группы активов (spec 0038)", () => {
  /** F01, F02 (usdm; F02 выключен) и S01 (spot) — у каждого открытая сделка и закрытая с PnL. */
  async function groups() {
    await seedExperiments(db, [
      exp("F01"),
      { ...exp("F02"), enabled: false },
      { ...exp("S01"), market: "spot" },
    ]);
    const runId = await ensureRun(db);
    const store = createDbExperimentStore(db);
    for (const [id, market] of [
      ["F01", "usdm"],
      ["F02", "usdm"],
      ["S01", "spot"],
    ] as const) {
      await store.insertTrade({
        ...trade(`${id}-open`, runId),
        experimentId: id,
        market,
      });
      await store.insertTrade({
        ...trade(`${id}-done`, runId, true),
        experimentId: id,
        market,
      });
    }
    await store.setState("bars", { F01: 1, F02: 2, S01: 3 });
    return { runId, store };
  }

  const groupInput = (runId: number) => ({
    runId,
    market: "usdm",
    closes: [
      { id: "F01-open", close: manual(5, 105), noPrice: false },
      { id: "F02-open", close: manual(0, 100), noPrice: true },
    ],
    initialBudget: 20_000,
    bars: { F01: 500, F02: 600 },
    barsKey: "bars",
  });

  it("закрывает сделки группы, начинает учёт с нового бюджета и метит свечи; эпоха и другие группы те же", async () => {
    const { runId, store } = await groups();
    expect(await store.realizedPnl(runId)).toEqual({
      F01: 3.9,
      F02: 3.9,
      S01: 3.9,
    });

    const r = await resetGroupRun(db, groupInput(runId));
    expect(r).toEqual({ experiments: 2, closed: 2, closedWithoutPrice: 1 });

    // Новой эпохи нет; учёт группы с нуля, спот как был.
    expect(await store.currentRunId()).toBe(runId);
    expect(await db.select().from(runsTable)).toHaveLength(1);
    expect(await store.realizedPnl(runId)).toEqual({ S01: 3.9 });
    expect(await store.getState("bars")).toEqual({
      F01: 500,
      F02: 600,
      S01: 3,
    });

    const rows = await db
      .select()
      .from(experimentsTable)
      .orderBy(experimentsTable.id);
    expect(
      rows.map((e) => [e.id, e.initialBudget, e.resetAt !== null, e.enabled]),
    ).toEqual([
      ["F01", 20_000, true, true],
      ["F02", 20_000, true, false],
      ["S01", 10_000, false, true],
    ]);

    const trades = await db.select().from(paperTradesTable);
    const s01Open = trades.find((t) => t.id === "S01-open");
    expect(s01Open?.closedAt).toBeNull();
    const f02Open = trades.find((t) => t.id === "F02-open");
    expect(f02Open?.exitReason).toBe("manual");
    expect(f02Open?.signal).toEqual({ bar: 1, resetWithoutPrice: true });
  });

  it("метки свечей и закрытия чужой группы не применяются", async () => {
    const { runId, store } = await groups();
    const r = await resetGroupRun(db, {
      ...groupInput(runId),
      closes: [
        { id: "F01-open", close: manual(5, 105), noPrice: false },
        { id: "S01-open", close: manual(-7, 90), noPrice: false },
      ],
      bars: { F01: 500, S01: 999 },
    });
    expect(r).toEqual({ experiments: 2, closed: 1, closedWithoutPrice: 0 });
    expect(await store.getState("bars")).toEqual({ F01: 500, F02: 2, S01: 3 });
    // Сделка спота осталась открытой: закрытие чужой группы в плане не применено.
    const [s01] = await db
      .select()
      .from(paperTradesTable)
      .where(eq(paperTradesTable.id, "S01-open"));
    expect(s01.closedAt).toBeNull();
    expect(s01.exitReason).toBeNull();
  });

  it("регрессия AC9: «Сбросить все Paper» после сброса группы — новая эпоха для всех, защита fromRunId", async () => {
    const { runId, store } = await groups();
    await resetGroupRun(db, groupInput(runId));
    const out = await resetRun(db, {
      fromRunId: runId,
      closes: [],
      state: {},
      initialBudget: 30_000,
    });
    expect(out).toMatchObject({ created: true, runId: runId + 1 });
    expect(
      await resetRun(db, { fromRunId: runId, closes: [], state: {} }),
    ).toEqual({ created: false, runId: runId + 1 });
    const rows = await db.select().from(experimentsTable);
    expect(
      rows.every((e) => e.initialBudget === 30_000 && e.resetAt === null),
    ).toBe(true);
    expect(await store.currentRunId()).toBe(runId + 1);
  });

  it("группа без экспериментов — ничего не меняется", async () => {
    const { runId, store } = await groups();
    expect(
      await resetGroupRun(db, {
        ...groupInput(runId),
        market: "coinm",
        closes: [],
        bars: {},
      }),
    ).toEqual({ experiments: 0, closed: 0, closedWithoutPrice: 0 });
    expect(await store.realizedPnl(runId)).toEqual({
      F01: 3.9,
      F02: 3.9,
      S01: 3.9,
    });
  });
});
