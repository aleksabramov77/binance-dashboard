import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { experimentsTable } from "../model/db.ts";
import {
  createDbExperimentStore,
  ensureRun,
  seedExperiments,
} from "./dbStore.ts";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

const exp = (id: string, name = id): Experiment => ({
  id,
  market: "futures",
  name,
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

const trade = (id: string, runId: number): PaperTrade => ({
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
  checkedUntil: Date.parse("2026-10-10T10:01:00Z"),
  closedAt: null,
  exitPrice: null,
  exitReason: null,
  fees: 0.05,
  pnl: null,
  rMultiple: null,
  demoOrderRef: null,
  signal: { bar: 1 },
});

describe("хранилище лаборатории на Drizzle (PGlite)", () => {
  it("сид — upsert по id: описание обновляется, выключение пользователя сохраняется", async () => {
    await seedExperiments(db, [exp("F01"), exp("F02")]);
    await db.update(experimentsTable).set({ enabled: false });
    await seedExperiments(db, [exp("F01", "Новое имя"), exp("F02")]);
    const store = createDbExperimentStore(db);
    const list = await store.listExperiments();
    expect(list.map((e) => e.id)).toEqual(["F01", "F02"]);
    expect(list[0].name).toBe("Новое имя");
    expect(list.every((e) => !e.enabled)).toBe(true);
  });

  it("строка с незнакомым полем конфига пропускается, остальные читаются (spec 0029)", async () => {
    await seedExperiments(db, [exp("F01"), exp("F02")]);
    await db
      .update(experimentsTable)
      .set({ config: { ...exp("F01").config, marketFiltr: {} } as never })
      .where(eq(experimentsTable.id, "F01"));
    const invalid: string[] = [];
    const list = await createDbExperimentStore(db).listExperiments((r) =>
      invalid.push(`${r.id}: ${r.problem}`),
    );
    expect(list.map((e) => e.id)).toEqual(["F02"]);
    expect(invalid).toEqual([
      expect.stringMatching(/^F01: config\.marketFiltr — /),
    ]);
  });

  it("первая эпоха создаётся один раз", async () => {
    const a = await ensureRun(db);
    expect(await ensureRun(db)).toBe(a);
    expect(await createDbExperimentStore(db).currentRunId()).toBe(a);
  });

  it("сделка: вставка идемпотентна, обновление, закрытие, реализованный PnL", async () => {
    await seedExperiments(db, [exp("F01")]);
    const store = createDbExperimentStore(db);
    const run = await store.currentRunId();
    await store.insertTrade(trade("t1", run));
    await store.insertTrade(trade("t1", run));
    await store.insertTrade(trade("t2", run));
    expect(await store.openTrades(run)).toHaveLength(2);

    await store.updateTrade("t1", { stop: 99, extreme: 103, checkedUntil: 5 });
    const [t1] = await store.openTrades(run);
    expect(t1).toMatchObject({
      id: "t1",
      stop: 99,
      extreme: 103,
      checkedUntil: 5,
    });
    expect(t1.openedAt).toBe("2026-10-10T10:00:00.000Z");

    await store.closeTrade("t1", {
      closedAt: "2026-10-10T11:00:00.000Z",
      exitPrice: 104,
      exitReason: "tp",
      fees: 0.1,
      pnl: 3.9,
      rMultiple: 1.95,
    });
    await store.closeTrade("t2", {
      closedAt: "2026-10-10T11:00:00.000Z",
      exitPrice: 98,
      exitReason: "sl",
      fees: 0.1,
      pnl: -2.1,
      rMultiple: -1.05,
    });
    expect(await store.openTrades(run)).toHaveLength(0);
    expect((await store.realizedPnl(run)).F01).toBeCloseTo(1.8);
  });

  it("engine_state: get/set с перезаписью", async () => {
    const store = createDbExperimentStore(db);
    expect(await store.getState("enabled")).toBeUndefined();
    await store.setState("enabled", true);
    await store.setState("enabled", false);
    await store.setState("bars", { S01: 123 });
    expect(await store.getState("enabled")).toBe(false);
    expect(await store.getState("bars")).toEqual({ S01: 123 });
  });
});
