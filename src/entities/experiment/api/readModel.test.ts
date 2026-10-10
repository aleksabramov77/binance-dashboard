import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { runsTable } from "../model/db";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import { readExperimentDetail, readExperimentsOverview } from "./readModel";

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
  initialBudget: 1000,
  enabled: true,
  demoMirror: false,
});

const trade = (
  id: string,
  runId: number,
  experimentId: string,
  hour: number,
  pnl: number | null,
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market: "futures",
  symbol: "BTCUSDT",
  direction: "long",
  openedAt: `2026-10-10T${String(hour).padStart(2, "0")}:00:00.000Z`,
  entryPrice: 100,
  quantity: 1,
  initialStop: 98,
  stop: 98,
  takeProfit: 104,
  atr: 1,
  extreme: 100,
  checkedUntil: 0,
  closedAt:
    pnl === null
      ? null
      : `2026-10-10T${String(hour + 1).padStart(2, "0")}:00:00.000Z`,
  exitPrice: pnl === null ? null : 100 + pnl,
  exitReason: pnl === null ? null : pnl > 0 ? "tp" : "sl",
  fees: 0.1,
  pnl,
  rMultiple: pnl === null ? null : pnl / 2,
  demoOrderRef: null,
  signal: {},
});

describe("чтение для страниц лаборатории", () => {
  it("обзор: все эксперименты, статистика только текущей эпохи", async () => {
    await seedExperiments(db, [exp("F01"), exp("F02")]);
    const store = createDbExperimentStore(db);
    const old = await ensureRun(db);
    await store.insertTrade(trade("old", old, "F01", 1, 500));
    const [{ id: run }] = await db
      .insert(runsTable)
      .values({ note: "вторая" })
      .returning({ id: runsTable.id });
    await store.insertTrade(trade("a", run, "F01", 2, 10));
    await store.insertTrade(trade("b", run, "F01", 4, -4));
    await store.insertTrade(trade("c", run, "F01", 6, null));

    const overview = await readExperimentsOverview(db, true);
    expect(overview.run.id).toBe(run);
    expect(overview.engineEnabled).toBe(true);
    expect(overview.experiments.map((e) => e.id)).toEqual(["F01", "F02"]);
    expect(overview.experiments[0].stats).toMatchObject({
      trades: 3,
      closed: 2,
      open: 1,
      realizedPnl: 6,
      equity: 1006,
    });
    expect(overview.experiments[1].stats.trades).toBe(0);
  });

  it("детали: equity-кривая от старта эпохи и последние N сделок новыми сверху", async () => {
    await seedExperiments(db, [exp("F01"), exp("F02")]);
    const store = createDbExperimentStore(db);
    const run = await ensureRun(db);
    await store.insertTrade(trade("a", run, "F01", 2, 10));
    await store.insertTrade(trade("b", run, "F01", 4, -4));
    await store.insertTrade(trade("c", run, "F01", 6, null));
    await store.insertTrade(trade("x", run, "F02", 3, 99));

    const detail = await readExperimentDetail(db, "F01", false, 2);
    expect(detail?.experiment.id).toBe("F01");
    expect(detail?.trades.map((t) => t.id)).toEqual(["c", "b"]);
    expect(detail?.stats.trades).toBe(3);
    expect(detail?.equity.map((p) => p.equity)).toEqual([1000, 1010, 1006]);
    expect(await readExperimentDetail(db, "NOPE", false, 10)).toBeNull();
  });
});
