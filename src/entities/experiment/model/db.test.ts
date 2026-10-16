import { readFileSync } from "node:fs";
import path from "node:path";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import {
  experimentsTable as experiments,
  demoMirrorOrdersTable as mirrorOrders,
  paperTradesTable as paperTrades,
  runsTable as runs,
  skippedSignalsTable as skippedSignals,
} from "./db.ts";
import { mirrorProtectRefsSchema } from "./mirror.ts";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  await db.insert(experiments).values({
    id: "F06",
    market: "usdm",
    name: "Donchian-20, 1h",
    hypothesis: "Пробой канала продолжается",
    config: {
      timeframe: "1h",
      entry: { type: "donchian", period: 20 },
      exit: { stop: { type: "atr", mult: 2 }, takeProfit: null, trailAtr: 2 },
      universe: { type: "top", n: 30 },
      directions: ["long", "short"],
      maxOpen: 5,
    },
    initialBudget: 10_000,
  });
});
afterEach(() => close());

const trade = (id: string, runId: number) => ({
  id,
  runId,
  experimentId: "F06",
  market: "usdm",
  symbol: "BTCUSDT",
  direction: "long",
  openedAt: new Date("2026-10-10T10:00:00Z"),
  entryPrice: 60_000,
  quantity: 0.01,
  initialStop: 59_000,
  stop: 59_000,
  takeProfit: 62_000,
  atr: 500,
  extreme: 60_000,
  checkedUntil: Date.parse("2026-10-10T10:00:00Z"),
});

describe("таблицы лаборатории (PGlite)", () => {
  it("сохраняет и читает сделку, закрытие обновляет поля", async () => {
    const [run] = await db.insert(runs).values({}).returning();
    await db.insert(paperTrades).values(trade("t1", run.id));

    const open = await db
      .select()
      .from(paperTrades)
      .where(isNull(paperTrades.closedAt));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      symbol: "BTCUSDT",
      entryPrice: 60_000,
      fees: 0,
      signal: {},
      checkedUntil: Date.parse("2026-10-10T10:00:00Z"),
    });

    await db
      .update(paperTrades)
      .set({
        closedAt: new Date("2026-10-10T12:00:00Z"),
        exitPrice: 62_000,
        exitReason: "tp",
        pnl: 19.4,
        rMultiple: 2,
      })
      .where(eq(paperTrades.id, "t1"));
    const [closed] = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.id, "t1"));
    expect(closed).toMatchObject({ exitReason: "tp", pnl: 19.4 });
  });

  it("новая эпоха: текущая — последняя, сделки прошлой остаются", async () => {
    const [first] = await db.insert(runs).values({}).returning();
    await db.insert(paperTrades).values(trade("old", first.id));
    const [second] = await db
      .insert(runs)
      .values({ note: "Сброс тестовых капиталов" })
      .returning();

    const [current] = await db
      .select()
      .from(runs)
      .orderBy(desc(runs.id))
      .limit(1);
    expect(current.id).toBe(second.id);
    expect(current.id).toBeGreaterThan(first.id);

    const inCurrent = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.runId, current.id));
    expect(inCurrent).toHaveLength(0);
    expect(await db.select().from(paperTrades)).toHaveLength(1);
  });

  it("сделка без эксперимента отклоняется внешним ключом", async () => {
    const [run] = await db.insert(runs).values({}).returning();
    await expect(
      db
        .insert(paperTrades)
        .values({ ...trade("x", run.id), experimentId: "NOPE" }),
    ).rejects.toThrow();
  });
});

describe("миграция 0008 (spec 0030): контекст входа, MAE, отсечённые сигналы", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "drizzle/0008_entry_context_mae_skipped.sql"),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  it("сделка прод-формата (без новых колонок) получает entry_context = {} и mae = null", async () => {
    const [run] = await db.insert(runs).values({}).returning();
    await db.execute(
      sql`insert into paper_trades (id, run_id, experiment_id, market, symbol, direction, opened_at, entry_price, quantity, atr, extreme, checked_until) values ('old', ${run.id}, 'F06', 'usdm', 'BTCUSDT', 'long', now(), 100, 1, 1, 100, 0)`,
    );
    const [old] = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.id, "old"));
    expect(old.entryContext).toEqual({});
    expect(old.mae).toBeNull();
  });

  it("повторный запуск на применённой схеме с данными ничего не ломает", async () => {
    const [run] = await db.insert(runs).values({}).returning();
    await db.insert(paperTrades).values({
      ...trade("t1", run.id),
      mae: 99,
      entryContext: { v: 1, adx14: 30 },
    });
    await db.insert(skippedSignals).values({
      id: "s1",
      runId: run.id,
      experimentId: "F06",
      market: "usdm",
      symbol: "ETHUSDT",
      direction: "long",
      bar: 0,
      at: new Date(),
      reason: "max-open",
      entryPrice: 100,
      stop: 98,
      takeProfit: null,
    });
    for (const statement of migration) await db.execute(sql.raw(statement));
    const [t1] = await db.select().from(paperTrades);
    expect(t1).toMatchObject({ mae: 99, entryContext: { v: 1, adx14: 30 } });
    expect(await db.select().from(skippedSignals)).toHaveLength(1);
  });
});

describe("миграция 0009 (spec 0046): варианты и причина выключения", () => {
  const migration = readFileSync(
    path.join(
      process.cwd(),
      "drizzle/0009_experiment_variants_disable_reason.sql",
    ),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  it("старая строка — без родителя и причины; повторный запуск не трогает данные", async () => {
    const [before] = await db.select().from(experiments);
    expect(before).toMatchObject({
      parentId: null,
      variantNote: null,
      disabledReason: null,
      disabledNote: null,
      disabledAt: null,
    });
    await db
      .update(experiments)
      .set({
        parentId: "F96",
        variantNote: "цель 3R вместо 2R",
        disabledReason: "loser",
        disabledNote: "минус за две эпохи",
        disabledAt: new Date("2026-10-16T10:00:00Z"),
      })
      .where(eq(experiments.id, "F06"));
    for (const statement of migration) await db.execute(sql.raw(statement));
    const [after] = await db.select().from(experiments);
    expect(after).toMatchObject({
      parentId: "F96",
      variantNote: "цель 3R вместо 2R",
      disabledReason: "loser",
      disabledNote: "минус за две эпохи",
      disabledAt: new Date("2026-10-16T10:00:00Z"),
    });
  });
});

describe("миграция 0007: futures → usdm (spec 0023, AC2)", () => {
  const MIGRATION = new URL(
    "../../../../drizzle/0007_futures_to_usdm.sql",
    import.meta.url,
  );
  const migrate = async () => {
    for (const statement of readFileSync(MIGRATION, "utf8").split(
      "--> statement-breakpoint",
    ))
      await db.execute(sql.raw(statement));
  };

  it("переводит market и protect_refs старых строк в usdm; spot и повтор не меняются", async () => {
    // Строки в формате прода до миграции (миграции PGlite уже применены — пишем старые значения сами).
    await db
      .update(experiments)
      .set({ market: "futures" })
      .where(eq(experiments.id, "F06"));
    const [run] = await db.insert(runs).values({}).returning();
    await db.insert(paperTrades).values([
      { ...trade("t1", run.id), market: "futures" },
      { ...trade("t2", run.id), market: "spot", symbol: "ETHUSDT" },
    ]);
    await db.insert(mirrorOrders).values([
      {
        tradeId: "t1",
        experimentId: "F06",
        market: "futures",
        symbol: "BTCUSDT",
        direction: "long",
        status: "protected",
        protectRefs: {
          market: "futures",
          entryOrderId: 1,
          stop: { algoId: 2, clientAlgoId: "s" },
          takeProfit: null,
        },
      },
      {
        tradeId: "t2",
        experimentId: "F06",
        market: "spot",
        symbol: "ETHUSDT",
        direction: "long",
        status: "protected",
        protectRefs: {
          market: "spot",
          orderListId: 5,
          stop: null,
          takeProfit: null,
        },
      },
    ]);

    await migrate();
    await migrate();

    const [e] = await db.select().from(experiments);
    expect(e.market).toBe("usdm");
    const tradesByid = Object.fromEntries(
      (await db.select().from(paperTrades)).map((t) => [t.id, t.market]),
    );
    expect(tradesByid).toEqual({ t1: "usdm", t2: "spot" });
    const mirrors = await db
      .select()
      .from(mirrorOrders)
      .orderBy(mirrorOrders.tradeId);
    expect(mirrors.map((m) => m.market)).toEqual(["usdm", "spot"]);
    expect(mirrors[0].protectRefs).toMatchObject({
      market: "usdm",
      entryOrderId: 1,
      stop: { algoId: 2, clientAlgoId: "s" },
    });
    expect(mirrors[1].protectRefs).toMatchObject({ market: "spot" });
  });

  it("protect_refs со старым market, который миграция не застала, читаются как usdm", () => {
    expect(
      mirrorProtectRefsSchema.parse({
        market: "futures",
        entryOrderId: null,
        stop: null,
        takeProfit: null,
      }),
    ).toMatchObject({ market: "usdm" });
  });
});
