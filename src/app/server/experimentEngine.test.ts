import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDbExperimentStore,
  ensureRun,
  paperTradesTable,
  seedExperiments,
} from "@/entities/experiment";
import {
  ENGINE_KEYS,
  EXPERIMENT_CATALOG,
  runTick,
  type TickDeps,
} from "@/features/paper-engine";
import { createMemoryDb, type Db } from "@/shared/db/client.server";

// Сквозная проверка композиции 2b: тик движка пишет в БД (PGlite в памяти) по каталогу.
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  await seedExperiments(db, EXPERIMENT_CATALOG);
  await ensureRun(db);
});
afterEach(() => close());

// Полночь: свежие свечи всех TF, включая 1d (по устаревшим сигналам движок не входит).
const NOW = Date.parse("2026-10-10T00:00:30Z");
const STEP: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

const deps = (runner: TickDeps["runner"]): TickDeps => ({
  runner,
  store: createDbExperimentStore(db),
  candles: async (_m, _s, interval, limit) => {
    const ms = STEP[interval];
    const current = Math.floor(NOW / ms) * ms;
    return Array.from({ length: limit }, (_, i) => ({
      openTime: current - (limit - 1 - i) * ms,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    }));
  },
  tickers: async () => [
    {
      symbol: "BTCUSDT",
      lastPrice: 100,
      priceChangePercent: 1,
      quoteVolume: 1e10,
    },
  ],
  funding: async () => ({ BTCUSDT: 0.0001 }),
  cache: new Map(),
});

describe("движок лаборатории + БД", () => {
  it("сид создаёт 40 экспериментов и эпоху; по умолчанию движок выключен", async () => {
    const store = createDbExperimentStore(db);
    expect(await store.listExperiments()).toHaveLength(40);
    expect((await runTick(deps("oracle"), NOW)).status).toBe("disabled");
  });

  it("включённый тик пишет сделки hold (S20, F20) и momentum (S18) в paper_trades и не дублирует их", async () => {
    const store = createDbExperimentStore(db);
    await store.setState(ENGINE_KEYS.enabled, true);
    const r = await runTick(deps("oracle"), NOW);
    expect(r.errors).toEqual([]);
    const rows = await db.select().from(paperTradesTable);
    expect(rows.map((t) => t.experimentId).sort()).toEqual([
      "F20",
      "S18",
      "S20",
    ]);
    await store.setState(ENGINE_KEYS.bars, {});
    await runTick(deps("oracle"), NOW);
    expect(await db.select().from(paperTradesTable)).toHaveLength(3);
  });

  it("раннер supabase в engine_state — тик oracle ничего не пишет", async () => {
    const store = createDbExperimentStore(db);
    await store.setState(ENGINE_KEYS.enabled, true);
    await store.setState(ENGINE_KEYS.runner, "supabase");
    expect((await runTick(deps("oracle"), NOW)).status).toBe("foreign-runner");
    expect(await db.select().from(paperTradesTable)).toHaveLength(0);
  });
});
