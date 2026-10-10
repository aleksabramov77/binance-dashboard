import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { experimentsTable, paperTradesTable, runsTable } from "../model/db";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import {
  getEpoch,
  type ResetRunInput,
  resetRun,
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
  market: "futures",
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
  market: "futures",
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
  marketBudget: 30_000,
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

  it("пишет метки свечей и делит бюджет рынка поровну между его экспериментами", async () => {
    const { runId, store } = await setup();
    await resetRun(db, input(runId));
    expect(await store.getState("bars")).toEqual({ F01: 123 });
    const budgets = (await store.listExperiments()).map((e) => e.initialBudget);
    expect(budgets).toEqual([15_000, 15_000]);
  });

  it("без бюджета — бюджеты экспериментов не меняются", async () => {
    const { runId, store } = await setup();
    await resetRun(db, { ...input(runId), marketBudget: undefined });
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
    expect(await setExperimentEnabled(db, "F01", false)).toBe(true);
    expect(await setExperimentEnabled(db, "NOPE", false)).toBe(false);
    const [row] = await db
      .select()
      .from(experimentsTable)
      .where(eq(experimentsTable.id, "F01"));
    expect(row.enabled).toBe(false);
  });
});
