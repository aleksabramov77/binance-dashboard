import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDbExperimentStore,
  ENGINE_TICK_LOCK_KEY,
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
  type EngineTickEnv,
  prepareEngineDb,
  runEngineTick,
} from "./engineTick";

// Общая композиция тика (VM и Edge Function Supabase, spec 007b): no-op чужого раннера, блокировка
// тика (advisory lock), идемпотентность повтора. PGlite в памяти с миграциями drizzle/.
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
  fetchFundingRates: async () => ({ BTCUSDT: 0.0001 }),
};

const env = (over: Partial<EngineTickEnv> = {}): EngineTickEnv => ({
  db,
  runner: "supabase",
  market,
  perpetuals: async () => new Set(["BTCUSDT"]),
  cache: new Map(),
  ...over,
});

const advisoryLocks = (tx: ExperimentDb) =>
  tx.execute(
    sql`select objid::bigint as key from pg_locks where locktype = 'advisory'`,
  );

const rowsOf = (r: unknown) =>
  Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows;

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

describe("withEngineTickLock (advisory lock)", () => {
  it("держит pg_try_advisory_xact_lock с фиксированным ключом на время тика и снимает после", async () => {
    let inside: unknown[] = [];
    const r = await withEngineTickLock(db, async (tx) => {
      inside = rowsOf(await advisoryLocks(tx));
      return 42;
    });
    expect(r).toEqual({ acquired: true, value: 42 });
    expect(inside.map((x) => Number((x as { key: unknown }).key))).toContain(
      ENGINE_TICK_LOCK_KEY,
    );
    expect(rowsOf(await advisoryLocks(db))).toHaveLength(0);
  });

  it("блокировка занята другим сеансом — второй тик пропускается (locked), в БД ничего не пишет", async () => {
    // PGlite — один сеанс, а advisory lock в своём сеансе реентерабелен. Чужой сеанс имитируем:
    // ответ pg_try_advisory_xact_lock подменяется на false, остальные запросы идут в настоящую БД.
    const store = createDbExperimentStore(db);
    await store.setState(ENGINE_KEYS.runner, "supabase");
    await store.setState(ENGINE_KEYS.enabled, true);
    const busy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "transaction") return Reflect.get(target, prop, receiver);
        return (fn: (tx: ExperimentDb) => Promise<unknown>) =>
          target.transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(t, p, r) {
                  if (p !== "execute") return Reflect.get(t, p, r);
                  return async () => ({ rows: [{ locked: false }] });
                },
              }),
            ),
          );
      },
    });
    const prepare = vi.fn(prepareEngineDb);
    const r = await runEngineTick(env({ db: busy, prepare }), NOW);
    expect(r.status).toBe("locked");
    expect(prepare).not.toHaveBeenCalled();
    expect(await db.select().from(paperTradesTable)).toHaveLength(0);
    expect(await store.getState(ENGINE_KEYS.lastTick)).toBeUndefined();
  });

  it("ошибка внутри тика откатывает транзакцию и снимает блокировку", async () => {
    await expect(
      withEngineTickLock(db, async (tx) => {
        await createDbExperimentStore(tx).setState("probe", 1);
        throw new Error("сбой");
      }),
    ).rejects.toThrow("сбой");
    expect(await createDbExperimentStore(db).getState("probe")).toBeUndefined();
    expect(rowsOf(await advisoryLocks(db))).toHaveLength(0);
  });
});

// Настоящая конкуренция двух сеансов — только на живом Postgres (не прод!): TEST_POSTGRES_URL.
const pgUrl = process.env.TEST_POSTGRES_URL;
describe.skipIf(!pgUrl)("withEngineTickLock на Postgres: два сеанса", () => {
  it("пока первый тик держит блокировку, второй получает acquired: false", async () => {
    const a = postgres(pgUrl as string, { max: 1, prepare: false });
    const b = postgres(pgUrl as string, { max: 1, prepare: false });
    try {
      let release = () => {};
      const hold = new Promise<void>((r) => {
        release = r;
      });
      let entered = () => {};
      const inside = new Promise<void>((r) => {
        entered = r;
      });
      const first = withEngineTickLock(
        drizzle(a) as unknown as ExperimentDb,
        async () => {
          entered();
          await hold;
          return "first";
        },
      );
      await inside;
      const second = await withEngineTickLock(
        drizzle(b) as unknown as ExperimentDb,
        async () => "second",
      );
      expect(second).toEqual({ acquired: false });
      release();
      expect(await first).toEqual({ acquired: true, value: "first" });
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });
});

describe("buildTickDeps: свечи", () => {
  it("прокидывает startTime в fetchKlines и режет limit до 1000 (баг 0028)", async () => {
    const fetchKlines = vi.fn(market.fetchKlines);
    const deps = buildTickDeps(
      env({ market: { ...market, fetchKlines } }),
      createDbExperimentStore(db),
    );
    await deps.candles("futures", "BTCUSDT", "1m", 1500, 1_000_000);
    await deps.candles("spot", "BTCUSDT", "1h", 301);
    expect(fetchKlines.mock.calls).toEqual([
      ["futures", "BTCUSDT", "1m", 1000, 1_000_000],
      ["spot", "BTCUSDT", "1h", 301, undefined],
    ]);
  });

  it("пустой справочник фьючерсов (после фильтра только крипты) — warn в журнал (spec 0029)", async () => {
    const log = vi.fn();
    const deps = buildTickDeps(
      env({ perpetuals: async () => new Set(), log }),
      createDbExperimentStore(db),
    );
    expect(await deps.tickers("futures")).toEqual([]);
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
