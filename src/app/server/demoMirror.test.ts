import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimMirror,
  createDbExperimentStore,
  ensureRun,
  experimentsTable,
  listMirrorCandidates,
  seedExperiments,
  setExperimentDemoMirror,
  updateMirror,
} from "@/entities/experiment";
import { closeDemoPosition } from "@/features/execute-trade";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { resetDemo, resetGroupDemo } from "./demoMirror";

// Демо-сброс без биржи (spec 0038, AC9): БД — SQLite в памяти, закрытие позиции — мок. Реальный демо-счёт общий
// с продом — против него сброс не вызываем.
let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
vi.mock("@/features/execute-trade", () => ({
  closeDemoPosition: vi.fn(),
  placeTrade: vi.fn(),
  sweepTriggeredLegs: vi.fn(),
}));
vi.mock("@/shared/api/binance/demo.server", () => ({
  fetchDemoPositionMode: vi.fn(),
  fetchDemoSymbolRules: vi.fn(),
}));
vi.mock("./experimentSettings", () => ({
  getLabSettings: vi.fn(async () => ({ stub: true })),
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
  market: PaperTrade["market"],
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market,
  symbol: "ETHUSDT",
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

beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  await seedExperiments(db, [
    exp("PF99", "usdm"),
    exp("PS99", "spot"),
    exp("PC99", "coinm"),
  ]);
  const runId = await ensureRun(db);
  const store = createDbExperimentStore(db);
  await store.insertTrade(trade("f", runId, "PF99", "usdm"));
  await store.insertTrade(trade("s", runId, "PS99", "spot"));
  await setExperimentDemoMirror(db, "PF99", true);
  await setExperimentDemoMirror(db, "PS99", true);
  for (const c of await listMirrorCandidates(
    db,
    new Date(Date.now() - 60_000),
  )) {
    await claimMirror(db, c);
    await updateMirror(db, c.tradeId, {
      status: "protected",
      message: "ok",
      steps: [],
      entryPrice: 100,
      quantity: 0.5,
    });
  }
  vi.mocked(closeDemoPosition).mockResolvedValue({
    status: "closed",
    message: "закрыта",
    steps: [],
    exitPrice: 101,
  });
});
afterEach(async () => {
  vi.clearAllMocks();
  await close();
});

const demoResetIds = async () =>
  (
    await db
      .select({ id: experimentsTable.id, at: experimentsTable.demoResetAt })
      .from(experimentsTable)
  )
    .filter((r) => r.at !== null)
    .map((r) => r.id)
    .sort();

describe("resetDemo", () => {
  it("регрессия AC9: null — закрывает позиции и сбрасывает демо всех экспериментов", async () => {
    const r = await resetDemo(null);
    expect(r).toEqual({ closed: 2, failed: 0, settings: { stub: true } });
    expect(closeDemoPosition).toHaveBeenCalledTimes(2);
    expect(await demoResetIds()).toEqual(["PC99", "PF99", "PS99"]);
  });

  it("id — только этот эксперимент", async () => {
    const r = await resetDemo("PS99");
    expect(r.closed).toBe(1);
    expect(await demoResetIds()).toEqual(["PS99"]);
  });
});

describe("resetGroupDemo", () => {
  it("группа — позиции и демо-статистика только её экспериментов", async () => {
    vi.mocked(closeDemoPosition).mockResolvedValue({
      status: "failed",
      message: "биржа не ответила",
      steps: [],
      exitPrice: null,
    });
    const r = await resetGroupDemo("usdm");
    expect(r).toMatchObject({
      account: "demo",
      experiments: 1,
      closed: 0,
      failed: 1,
    });
    expect(closeDemoPosition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(closeDemoPosition).mock.calls[0][0]).toMatchObject({
      tradeId: "f",
    });
    expect(await demoResetIds()).toEqual(["PF99"]);
  });

  it("COIN-M (spec 0056) — закрывает демо-позиции COIN-M со ссылками и начинает демо-эру группы", async () => {
    const runId = await ensureRun(db);
    await createDbExperimentStore(db).insertTrade({
      ...trade("c", runId, "PC99", "coinm"),
      symbol: "BTCUSD_PERP",
    });
    await setExperimentDemoMirror(db, "PC99", true);
    const [c] = await listMirrorCandidates(db, new Date(Date.now() - 60_000));
    expect(c).toMatchObject({ tradeId: "c", market: "coinm" });
    await claimMirror(db, c);
    const protectRefs = {
      market: "coinm" as const,
      entryOrderId: 1,
      legs: "quantity" as const,
      stop: { algoId: 2, clientAlgoId: "bdc-S" },
      takeProfit: null,
      contracts: 1,
      contractSize: 100,
    };
    await updateMirror(db, "c", {
      status: "protected",
      message: "ok",
      steps: [],
      entryPrice: 81_000,
      quantity: 100 / 81_000,
      protectRefs,
    });
    const r = await resetGroupDemo("coinm");
    expect(r).toMatchObject({
      account: "demo",
      experiments: 1,
      closed: 1,
      failed: 0,
    });
    expect(closeDemoPosition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(closeDemoPosition).mock.calls[0][0]).toMatchObject({
      tradeId: "c",
      market: "coinm",
      symbol: "BTCUSD_PERP",
      protectRefs,
    });
    expect(await demoResetIds()).toEqual(["PC99"]);
  });
});
