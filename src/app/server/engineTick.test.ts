import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDbExperimentStore,
  type ExperimentDb,
  engineStateTable,
  experimentsTable,
  paperTradesTable,
  seedExperiments,
  withEngineTickLock,
} from "@/entities/experiment";
import { ENGINE_KEYS, EXPERIMENT_CATALOG } from "@/features/paper-engine";
import { createMemoryDb } from "@/shared/db/client.server";
import {
  buildTickDeps,
  createPerpetualsSource,
  createPerpetualsSources,
  type EngineTickEnv,
  prepareEngineDb,
  runEngineTick,
} from "./engineTick";

// Общая композиция тика (VM и Edge Function Supabase, spec 007b): no-op чужого раннера, блокировка
// тика, идемпотентность повтора. SQLite в памяти с миграциями drizzle/.
let db: ExperimentDb;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

const NOW = Date.parse("2026-10-10T00:00:30Z");
const STEP: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

const market: EngineTickEnv["market"] = {
  fetchKlines: async (_m, _s, interval, limit) => {
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
  fetch24hTickers: async () => [
    {
      symbol: "BTCUSDT",
      lastPrice: 100,
      priceChangePercent: 1,
      highPrice: 101,
      lowPrice: 99,
      quoteVolume: 1e10,
    },
  ],
  fetchCoinmTickers: async () => [
    {
      symbol: "BTCUSD_PERP",
      lastPrice: 100,
      priceChangePercent: 1,
      highPrice: 101,
      lowPrice: 99,
      volume: 1e7,
    },
    // Нет в справочнике бессрочных (поставочный) — в тикеры движка не попадает.
    {
      symbol: "BTCUSD_251226",
      lastPrice: 100,
      priceChangePercent: 1,
      highPrice: 101,
      lowPrice: 99,
      volume: 1e7,
    },
  ],
  fetchFundingRates: async () => ({ BTCUSDT: 0.0001 }),
};

const env = (over: Partial<EngineTickEnv> = {}): EngineTickEnv => ({
  db,
  runner: "supabase",
  market,
  perpetuals: async (m) =>
    new Map(m === "usdm" ? [["BTCUSDT", null]] : [["BTCUSD_PERP", 100]]),
  cache: new Map(),
  ...over,
});

describe("runEngineTick: раннер", () => {
  it("runner = oracle (по умолчанию) — тик supabase no-op: ни сида, ни записей в БД", async () => {
    const prepare = vi.fn(prepareEngineDb);
    const fetchKlines = vi.fn(market.fetchKlines);
    const r = await runEngineTick(
      env({ prepare, market: { ...market, fetchKlines } }),
      NOW,
    );
    expect(r.status).toBe("foreign-runner");
    expect(r.runner).toBe("supabase");
    expect(prepare).not.toHaveBeenCalled();
    expect(fetchKlines).not.toHaveBeenCalled();
    expect(await db.select().from(experimentsTable)).toHaveLength(0);
    expect(await db.select().from(engineStateTable)).toHaveLength(0);
  });

  it("runner = supabase, движок включён — тик пишет сделки, повтор в ту же минуту их не дублирует", async () => {
    const store = createDbExperimentStore(db);
    await store.setState(ENGINE_KEYS.runner, "supabase");
    await store.setState(ENGINE_KEYS.enabled, true);
    const r = await runEngineTick(env({ prepare: prepareEngineDb }), NOW);
    expect(r.status).toBe("ok");
    expect(r.errors).toEqual([]);
    expect(await db.select().from(experimentsTable)).toHaveLength(40);
    const first = await db.select().from(paperTradesTable);
    expect(first.length).toBeGreaterThan(0);

    const again = await runEngineTick(env({ prepare: prepareEngineDb }), NOW);
    expect(again.status).toBe("ok");
    expect(again.opened).toBe(0);
    expect(await db.select().from(paperTradesTable)).toHaveLength(first.length);
  });

  it("runner = supabase, движок выключен — disabled, сделок нет", async () => {
    await createDbExperimentStore(db).setState(ENGINE_KEYS.runner, "supabase");
    const r = await runEngineTick(env({ prepare: prepareEngineDb }), NOW);
    expect(r.status).toBe("disabled");
    expect(await db.select().from(paperTradesTable)).toHaveLength(0);
  });
});

describe("withEngineTickLock (в памяти процесса, spec 0059)", () => {
  it("второй тик, пока идёт первый, — locked: ничего не пишет; после первого — снова идёт (AC3)", async () => {
    const store = createDbExperimentStore(db);
    await store.setState(ENGINE_KEYS.runner, "supabase");
    await store.setState(ENGINE_KEYS.enabled, true);
    let release = () => {};
    const first = withEngineTickLock(
      db,
      () => new Promise<string>((r) => (release = () => r("first"))),
    );
    const prepare = vi.fn(prepareEngineDb);
    const r = await runEngineTick(env({ prepare }), NOW);
    expect(r.status).toBe("locked");
    expect(prepare).not.toHaveBeenCalled();
    expect(await db.select().from(paperTradesTable)).toHaveLength(0);
    expect(await store.getState(ENGINE_KEYS.lastTick)).toBeUndefined();
    release();
    expect(await first).toEqual({ acquired: true, value: "first" });
    expect(await withEngineTickLock(db, async () => 42)).toEqual({
      acquired: true,
      value: 42,
    });
  });

  it("ошибка внутри тика снимает блокировку", async () => {
    await expect(
      withEngineTickLock(db, async () => {
        throw new Error("сбой");
      }),
    ).rejects.toThrow("сбой");
    expect(await withEngineTickLock(db, async () => 1)).toEqual({
      acquired: true,
      value: 1,
    });
  });
});

describe("buildTickDeps: свечи", () => {
  it("прокидывает startTime в fetchKlines и режет limit до 1000 (баг 0028)", async () => {
    const fetchKlines = vi.fn(market.fetchKlines);
    const deps = buildTickDeps(
      env({ market: { ...market, fetchKlines } }),
      createDbExperimentStore(db),
    );
    await deps.candles("usdm", "BTCUSDT", "1m", 1500, 1_000_000);
    await deps.candles("spot", "BTCUSDT", "1h", 301);
    expect(fetchKlines.mock.calls).toEqual([
      ["usdm", "BTCUSDT", "1m", 1000, 1_000_000],
      ["spot", "BTCUSDT", "1h", 301, undefined],
    ]);
  });

  it("пустой справочник фьючерсов (после фильтра только крипты) — warn в журнал (spec 0029)", async () => {
    const log = vi.fn();
    const deps = buildTickDeps(
      env({ perpetuals: async () => new Map(), log }),
      createDbExperimentStore(db),
    );
    expect(await deps.tickers("usdm")).toEqual([]);
    expect(await deps.tickers("coinm")).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "engine.perpetuals",
      expect.stringContaining("пуст"),
    );
    log.mockClear();
    await deps.tickers("spot");
    expect(log).not.toHaveBeenCalled();
  });
});

describe("createPerpetualsSource", () => {
  it("кэширует справочник на TTL, при сбое обновления отдаёт старую копию", async () => {
    let now = 0;
    const fetchSymbols = vi
      .fn<() => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set(["A"]))
      .mockRejectedValueOnce(new Error("сеть"));
    const source = createPerpetualsSource(fetchSymbols, 1000, () => now);
    expect(await source()).toEqual(new Set(["A"]));
    now = 500;
    await source();
    expect(fetchSymbols).toHaveBeenCalledTimes(1);
    now = 2000;
    expect(await source()).toEqual(new Set(["A"]));
    expect(fetchSymbols).toHaveBeenCalledTimes(2);
  });
});

describe("buildTickDeps: группы активов (spec 0023)", () => {
  it("COIN-M: только бессрочные из справочника, оборот в $ и размер контракта; funding — своей группы", async () => {
    const funding = vi.fn(market.fetchFundingRates);
    const deps = buildTickDeps(
      env({ market: { ...market, fetchFundingRates: funding } }),
      createDbExperimentStore(db),
    );
    expect(await deps.tickers("coinm")).toEqual([
      {
        symbol: "BTCUSD_PERP",
        lastPrice: 100,
        priceChangePercent: 1,
        quoteVolume: 1e9,
        contractSize: 100,
      },
    ]);
    expect((await deps.tickers("usdm")).map((t) => t.symbol)).toEqual([
      "BTCUSDT",
    ]);
    await deps.funding("coinm");
    expect(await deps.funding("spot")).toEqual({});
    expect(funding.mock.calls).toEqual([["coinm"]]);
  });

  it("справочники USDⓈ-M и COIN-M кэшируются раздельно", async () => {
    const fetch = vi.fn(async (m: "usdm" | "coinm") => new Map([[m, null]]));
    const source = createPerpetualsSources(fetch, 1000, () => 0);
    await source("usdm");
    await source("coinm");
    await source("coinm");
    expect(fetch.mock.calls).toEqual([["usdm"], ["coinm"]]);
  });
});

describe("prepareEngineDb и приватные эксперименты (spec 0015)", () => {
  it("сид каталога не удаляет и не меняет строку с id не из каталога", async () => {
    // Фиктивный приватный эксперимент: записан pnpm lab:private, пользователь выключил его в /settings.
    await seedExperiments(db, [
      {
        id: "PS99",
        market: "spot",
        name: "Фиктивный",
        hypothesis: "Проверка",
        config: {
          timeframe: "1h",
          entry: { type: "hold" },
          exit: { stop: { type: "none" }, takeProfit: null },
          universe: { type: "majors" },
          directions: ["long"],
          maxOpen: 1,
        },
        initialBudget: 777,
        enabled: true,
        demoMirror: false,
      },
    ]);
    await db
      .update(experimentsTable)
      .set({ enabled: false })
      .where(eq(experimentsTable.id, "PS99"));
    const read = () =>
      db.select().from(experimentsTable).where(eq(experimentsTable.id, "PS99"));
    const [before] = await read();

    await prepareEngineDb(db);
    await prepareEngineDb(db);

    expect(await read()).toEqual([before]);
    expect(before).toMatchObject({ enabled: false, initialBudget: 777 });
    expect(await db.select().from(experimentsTable)).toHaveLength(
      EXPERIMENT_CATALOG.length + 1,
    );
  });
});
