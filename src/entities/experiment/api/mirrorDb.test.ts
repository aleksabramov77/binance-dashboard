import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import {
  activeMirrorSymbols,
  claimMirror,
  claimMirrorsToClose,
  claimOpenMirrors,
  listMirrorCandidates,
  markDemoReset,
  mirrorStatuses,
  mirrorSummaries,
  setExperimentDemoMirror,
  updateMirror,
} from "./mirrorDb";

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

const trade = (
  id: string,
  runId: number,
  experimentId: string,
  openedAt = "2026-10-11T11:55:00.000Z",
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market: "futures",
  symbol: "ETHUSDT",
  direction: "long",
  openedAt,
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
  signal: {},
});

const SINCE = new Date("2026-10-11T11:00:00.000Z");

async function setup() {
  await seedExperiments(db, [exp("F01"), exp("F02")]);
  const runId = await ensureRun(db);
  const store = createDbExperimentStore(db);
  await store.insertTrade(trade("a", runId, "F01"));
  await store.insertTrade(trade("b", runId, "F02"));
  await store.insertTrade(
    trade("old", runId, "F01", "2026-10-11T09:00:00.000Z"),
  );
  return store;
}

describe("demo-зеркало в БД", () => {
  it("кандидаты — только свежие сделки экспериментов с зеркалом", async () => {
    await setup();
    expect(await listMirrorCandidates(db, SINCE)).toEqual([]);
    expect(await setExperimentDemoMirror(db, "F01", true)).toBe(true);
    expect(await setExperimentDemoMirror(db, "nope", true)).toBe(false);
    const list = await listMirrorCandidates(db, SINCE);
    expect(list.map((c) => c.tradeId)).toEqual(["a"]);
    expect(list[0]).toMatchObject({ stop: 95, takeProfit: 110, quantity: 0.5 });
  });

  it("захват идемпотентен, захваченная сделка не кандидат, символ занят", async () => {
    await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    expect(await claimMirror(db, c)).toBe(true);
    expect(await claimMirror(db, c)).toBe(false);
    expect(await listMirrorCandidates(db, SINCE)).toEqual([]);
    expect(await activeMirrorSymbols(db)).toEqual(new Set(["futures:ETHUSDT"]));
  });

  it("закрытая paper-сделка с открытым зеркалом захватывается на закрытие один раз", async () => {
    const store = await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      demoRef: "r1",
      entryPrice: 100,
      quantity: 0.5,
    });
    expect(await claimMirrorsToClose(db)).toEqual([]);

    await store.closeTrade("a", {
      closedAt: "2026-10-11T12:30:00.000Z",
      exitPrice: 104,
      exitReason: "trail",
      fees: 0.1,
      pnl: 1.9,
      rMultiple: 0.4,
    });
    const toClose = await claimMirrorsToClose(db);
    expect(toClose).toEqual([
      {
        tradeId: "a",
        market: "futures",
        symbol: "ETHUSDT",
        direction: "long",
        quantity: 0.5,
        exitReason: "trail",
      },
    ]);
    expect(await claimMirrorsToClose(db)).toEqual([]);

    await updateMirror(db, "a", {
      status: "closed",
      message: "закрыта",
      steps: [],
      closed: true,
    });
    expect(await activeMirrorSymbols(db)).toEqual(new Set());
    expect(await mirrorStatuses(db, ["a", "b"])).toEqual(
      new Map([["a", { status: "closed", message: "закрыта" }]]),
    );
    const [paper] = (await store.openTrades(1)).filter((t) => t.id === "a");
    expect(paper).toBeUndefined();
  });
});

describe("демо-сводка и демо-сброс", () => {
  it("PnL по фактическому выходу зеркала, иначе по paper; сброс обнуляет и закрывает", async () => {
    const store = await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      entryPrice: 100,
      quantity: 0.5,
    });
    let summary = (await mirrorSummaries(db)).get("F01");
    expect(summary).toMatchObject({ trades: 1, open: 1, closed: 0 });

    // Демо-сброс: открытая позиция захватывается на закрытие, статистика начинается заново.
    const claimed = await claimOpenMirrors(db, "F01");
    expect(claimed.map((m) => m.tradeId)).toEqual(["a"]);
    expect(await claimOpenMirrors(db, null)).toEqual([]);
    await updateMirror(db, "a", {
      status: "closed",
      message: "сброс",
      steps: [],
      exitPrice: 104,
      closed: true,
    });
    summary = (await mirrorSummaries(db)).get("F01");
    expect(summary).toMatchObject({ closed: 1, wins: 1, pnl: 2 });

    await markDemoReset(db, "F01");
    expect((await mirrorSummaries(db)).get("F01")).toBeUndefined();

    // Без фактического выхода PnL — по цене выхода paper-сделки.
    const runId = await ensureRun(db);
    await store.insertTrade(trade("c", runId, "F01", new Date().toISOString()));
    const [fresh] = await listMirrorCandidates(
      db,
      new Date(Date.now() - 60_000),
    );
    await claimMirror(db, fresh);
    await updateMirror(db, "c", {
      status: "protected",
      message: "ok",
      steps: [],
      entryPrice: 100,
      quantity: 2,
    });
    await store.closeTrade("c", {
      closedAt: new Date().toISOString(),
      exitPrice: 99,
      exitReason: "sl",
      fees: 0,
      pnl: -2,
      rMultiple: -1,
    });
    await updateMirror(db, "c", {
      status: "closed",
      message: "биржа",
      steps: [],
      closed: true,
    });
    expect((await mirrorSummaries(db)).get("F01")).toMatchObject({
      closed: 1,
      losses: 1,
      pnl: -2,
    });
  });
});
