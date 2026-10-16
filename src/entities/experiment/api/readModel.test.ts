import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { experimentsTable, runsTable } from "../model/db";
import { statsQuerySchema } from "../model/statsView";
import {
  experimentDetailResponseSchema,
  experimentsResponseSchema,
} from "../model/view";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import {
  readExperimentDetail,
  readExperimentFlags,
  readExperimentsOverview,
  readLabDataset,
  readTradeStats,
} from "./readModel";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

const exp = (id: string): Experiment => ({
  id,
  market: "usdm",
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
  market: "usdm",
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
  mae: null,
  entryContext: {},
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

  it("сделки до spec 0030 (без контекста входа и MAE) не ломают страницы и контракт API", async () => {
    await seedExperiments(db, [exp("F01")]);
    const run = await ensureRun(db);
    // Строка прод-формата: новые колонки не заданы — значения по умолчанию миграции.
    await db.execute(
      sql`insert into paper_trades (id, run_id, experiment_id, market, symbol, direction, opened_at, entry_price, quantity, initial_stop, stop, atr, extreme, checked_until, closed_at, exit_price, exit_reason, pnl, r_multiple) values ('old', ${run}, 'F01', 'usdm', 'BTCUSDT', 'long', now() - interval '1 hour', 100, 1, 98, 98, 1, 101, 0, now(), 101, 'tp', 1, 0.5)`,
    );
    const detail = await readExperimentDetail(db, "F01", false, 10);
    expect(detail?.trades[0]).toMatchObject({ mae: null, entryContext: {} });
    expect(experimentDetailResponseSchema.parse(detail).trades).toHaveLength(1);
    const overview = await readExperimentsOverview(db, false);
    expect(
      experimentsResponseSchema.parse(overview).experiments[0].stats.closed,
    ).toBe(1);
    const stats = await readTradeStats(
      db,
      statsQuerySchema.parse({}),
      Date.now(),
    );
    expect(stats?.total.closed).toBe(1);
  });

  it("строка с незнакомым полем конфига не роняет страницы: пропускается и уходит в onInvalid (spec 0029)", async () => {
    await seedExperiments(db, [exp("F01"), exp("F02")]);
    await ensureRun(db);
    await db
      .update(experimentsTable)
      .set({ config: { ...exp("F02").config, marketFiltr: {} } as never })
      .where(eq(experimentsTable.id, "F02"));
    const invalid: { id: string; problem: string }[] = [];
    const onInvalid = (row: { id: string; problem: string }) =>
      invalid.push(row);

    const overview = await readExperimentsOverview(db, true, false, onInvalid);
    expect(overview.experiments.map((e) => e.id)).toEqual(["F01"]);
    expect(await readExperimentDetail(db, "F02", true, 10, onInvalid)).toBe(
      null,
    );
    expect((await readLabDataset(db, onInvalid)).experiments).toHaveLength(1);
    expect(invalid).toHaveLength(3);
    expect(invalid[0].id).toBe("F02");
    expect(invalid[0].problem).toMatch(/^config\.marketFiltr — /);
  });
});

describe("разрезы /stats", () => {
  const NOW = Date.parse("2026-10-10T12:00:00Z");
  const at = (base: PaperTrade, patch: Partial<PaperTrade>): PaperTrade => ({
    ...base,
    ...patch,
  });

  async function seed() {
    await seedExperiments(db, [
      exp("F01"),
      { ...exp("S01"), market: "spot", initialBudget: 500 },
    ]);
    const store = createDbExperimentStore(db);
    const old = await ensureRun(db);
    await store.insertTrade(trade("old", old, "F01", 1, 500));
    const [{ id: run }] = await db
      .insert(runsTable)
      .values({ note: "вторая" })
      .returning({ id: runsTable.id });
    await store.insertTrade(trade("a", run, "F01", 2, 10));
    await store.insertTrade(
      at(trade("b", run, "F01", 4, -4), {
        symbol: "ETHUSDT",
        direction: "short",
      }),
    );
    await store.insertTrade(
      at(trade("c", run, "S01", 6, -8), { market: "spot", symbol: "SOLUSDT" }),
    );
    // Закрыта 5 дней назад — вне «24 ч», внутри «7 дн».
    await store.insertTrade(
      at(trade("d", run, "S01", 1, 3), {
        market: "spot",
        closedAt: "2026-10-05T00:00:00.000Z",
      }),
    );
    return { old, run };
  }

  it("по умолчанию — текущая эпоха, разрез по эксперименту с подписями и бюджетами", async () => {
    const { old, run } = await seed();
    const r = await readTradeStats(
      db,
      { groupBy: "experiment", period: "epoch" },
      NOW,
    );
    expect(r?.run.id).toBe(run);
    expect(r?.runs.map((x) => x.id)).toEqual([run, old]);
    expect(r?.since).toBeNull();
    expect(r?.total).toMatchObject({ closed: 4, realizedPnl: 1, equity: 1501 });
    expect(
      r?.groups.map((g) => [g.label, g.stats.realizedPnl, g.stats.equity]),
    ).toEqual([
      ["F01 · F01", 6, 1006],
      ["S01 · S01", -5, 495],
    ]);
    expect(r?.options.symbols).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(r?.options.experiments.map((e) => e.id)).toEqual(["F01", "S01"]);
  });

  it("фильтры и период применяются на сервере; прошлая эпоха — по run", async () => {
    const { old } = await seed();
    const spotDay = await readTradeStats(
      db,
      { groupBy: "symbol", market: "spot", period: "24h" },
      NOW,
    );
    expect(spotDay?.groups.map((g) => [g.key, g.stats.realizedPnl])).toEqual([
      ["SOLUSDT", -8],
    ]);
    expect(spotDay?.total.initialBudget).toBe(500);

    const byDirection = await readTradeStats(
      db,
      { groupBy: "direction", period: "7d" },
      NOW,
    );
    expect(byDirection?.groups.map((g) => [g.label, g.stats.trades])).toEqual([
      ["Long (B)", 3],
      ["Short (S)", 1],
    ]);

    const byMarket = await readTradeStats(
      db,
      { groupBy: "market", period: "epoch", run: old },
      NOW,
    );
    expect(byMarket?.groups.map((g) => [g.label, g.stats.realizedPnl])).toEqual(
      [["USDⓈ-M", 500]],
    );
    expect(
      await readTradeStats(
        db,
        { groupBy: "market", period: "epoch", run: 999 },
        NOW,
      ),
    ).toBeNull();
  });
});

describe("данные для отчёта лаборатории (pnpm lab:report, lab:apply)", () => {
  it("readLabDataset: дата сброса эксперимента и сделки только текущей эпохи и текущего учёта", async () => {
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
    await store.insertTrade(trade("x", run, "F02", 3, 7));
    // сброс F02 после открытия x — сделка выпадает из его учёта
    await db
      .update(experimentsTable)
      .set({ resetAt: new Date("2026-10-10T05:00:00.000Z") })
      .where(eq(experimentsTable.id, "F02"));

    const data = await readLabDataset(db);
    expect(data.run.id).toBe(run);
    expect(data.experiments.map((e) => [e.id, e.resetAt])).toEqual([
      ["F01", null],
      ["F02", "2026-10-10T05:00:00.000Z"],
    ]);
    expect(data.trades.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("readLabDataset --run: прошлая эпоха с концом, сброс из следующей эпохи её учёт не трогает, отсечённые сигналы", async () => {
    await seedExperiments(db, [exp("F01"), exp("F02")]);
    const store = createDbExperimentStore(db);
    const first = await ensureRun(db);
    await store.insertTrade(trade("old", first, "F02", 1, 5));
    await store.insertSkippedSignals([
      {
        id: "s1",
        runId: first,
        experimentId: "F02",
        market: "usdm",
        symbol: "ETHUSDT",
        direction: "long",
        bar: 0,
        at: "2026-10-10T01:00:00.000Z",
        reason: "max-open",
        entryPrice: 100,
        stop: 98,
        takeProfit: null,
      },
    ]);
    const [second] = await db
      .insert(runsTable)
      .values({ note: "вторая" })
      .returning();
    // сброс F02 — уже во второй эпохе
    await db
      .update(experimentsTable)
      .set({ resetAt: new Date(second.startedAt.getTime() + 1000) })
      .where(eq(experimentsTable.id, "F02"));

    const past = await readLabDataset(db, undefined, first);
    expect(past.run).toEqual({
      id: first,
      startedAt: expect.any(String),
      endedAt: second.startedAt.toISOString(),
    });
    expect(past.experiments.find((e) => e.id === "F02")?.resetAt).toBeNull();
    expect(past.trades.map((t) => t.id)).toEqual(["old"]);
    expect(past.skipped.map((s) => s.id)).toEqual(["s1"]);
    expect(past.skippedCounts).toEqual([
      { experimentId: "F02", reason: "max-open", count: 1 },
    ]);

    const current = await readLabDataset(db);
    expect(current.run).toMatchObject({ id: second.id, endedAt: null });
    expect(current.trades).toEqual([]);
    expect(current.skipped).toEqual([]);
    await expect(readLabDataset(db, undefined, 999)).rejects.toThrow(
      /эпохи 999 нет; есть: /,
    );
  });

  it("readExperimentFlags: тумблеры эксперимента и демо-зеркала по id", async () => {
    await seedExperiments(db, [exp("F01"), exp("F02")]);
    await db
      .update(experimentsTable)
      .set({ enabled: false, demoMirror: true, demoMirrorMode: "on" })
      .where(eq(experimentsTable.id, "F02"));
    expect(await readExperimentFlags(db)).toEqual([
      {
        id: "F01",
        name: "F01",
        market: "usdm",
        enabled: true,
        demoMirror: false,
        demoMirrorMode: "auto",
      },
      {
        id: "F02",
        name: "F02",
        market: "usdm",
        enabled: false,
        demoMirror: true,
        demoMirrorMode: "on",
      },
    ]);
  });
});
