import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { demoMirrorOrdersTable, paperTradesTable } from "../model/db";
import { MIRROR_STATUSES } from "../model/mirror";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import { readEngineExposure } from "./exposureDb";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

const exp: Experiment = {
  id: "F01",
  market: "usdm",
  name: "F01",
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
};

const trade = (id: string, runId: number): PaperTrade => ({
  id,
  runId,
  experimentId: "F01",
  market: "usdm",
  symbol: "ETHUSDT",
  direction: "long",
  openedAt: "2026-10-16T10:00:00.000Z",
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

describe("readEngineExposure", () => {
  it("пустая база — нули", async () => {
    expect(await readEngineExposure(db)).toEqual({ openPaper: 0, openDemo: 0 });
  });

  it("считает paper-сделки без closed_at и демо-позиции в активных статусах", async () => {
    await seedExperiments(db, [exp]);
    const runId = await ensureRun(db);
    const store = createDbExperimentStore(db);
    // По сделке на каждый статус зеркала + одна закрытая paper-сделка без зеркала.
    for (const status of MIRROR_STATUSES) {
      await store.insertTrade(trade(status, runId));
      await db.insert(demoMirrorOrdersTable).values({
        tradeId: status,
        experimentId: "F01",
        market: "usdm",
        symbol: "ETHUSDT",
        direction: "long",
        status,
      });
    }
    await store.insertTrade(trade("paper-closed", runId));
    await db
      .update(paperTradesTable)
      .set({ closedAt: new Date("2026-10-16T11:00:00.000Z") })
      .where(eq(paperTradesTable.id, "paper-closed"));

    // Активные: pending, protected, unprotected, closing, close_failed.
    expect(await readEngineExposure(db)).toEqual({
      openPaper: MIRROR_STATUSES.length,
      openDemo: 5,
    });
  });
});
