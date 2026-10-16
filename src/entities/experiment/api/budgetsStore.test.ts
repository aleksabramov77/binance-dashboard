import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { runsTable } from "../model/db";
import { loadBudgetInputs } from "./budgetsStore";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

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
  enabled: market === "spot",
  demoMirror: false,
});

const trade = (
  id: string,
  runId: number,
  experimentId: string,
  market: Experiment["market"],
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market,
  symbol: "BTCUSDT",
  direction: "long",
  openedAt: "2026-10-10T10:00:00.000Z",
  entryPrice: 100,
  quantity: 1,
  initialStop: null,
  stop: null,
  takeProfit: null,
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

const close_ = (pnl: number, fees: number) => ({
  closedAt: "2026-10-10T11:00:00.000Z",
  exitPrice: 101,
  exitReason: "tp" as const,
  fees,
  pnl,
  rMultiple: null,
});

describe("loadBudgetInputs", () => {
  it("берёт только сделки текущей эпохи и агрегирует закрытые по рынку", async () => {
    await seedExperiments(db, [exp("S01", "spot"), exp("F01", "usdm")]);
    const store = createDbExperimentStore(db);
    const old = await ensureRun(db);
    await store.insertTrade(trade("old", old, "S01", "spot"));
    await store.closeTrade("old", close_(999, 1));

    const [{ id: run }] = await db
      .insert(runsTable)
      .values({ note: "новая эпоха" })
      .returning({ id: runsTable.id });
    await store.insertTrade(trade("a", run, "S01", "spot"));
    await store.closeTrade("a", close_(10, 0.2));
    await store.insertTrade(trade("b", run, "S01", "spot"));
    await store.closeTrade("b", close_(-4, 0.2));
    await store.insertTrade(trade("c", run, "F01", "usdm"));

    const { runId, inputs } = await loadBudgetInputs(db);
    expect(runId).toBe(run);
    expect(inputs.experiments).toHaveLength(2);
    expect(inputs.closed).toEqual([{ market: "spot", pnl: 6, fees: 0.4 }]);
    expect(inputs.open).toEqual([
      {
        market: "usdm",
        symbol: "BTCUSDT",
        direction: "long",
        entryPrice: 100,
        quantity: 1,
      },
    ]);
  });
});
