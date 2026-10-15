import { readFileSync } from "node:fs";
import path from "node:path";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import {
  experimentsTable as experiments,
  paperTradesTable as paperTrades,
  runsTable as runs,
  skippedSignalsTable as skippedSignals,
} from "./db.ts";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  await db.insert(experiments).values({
    id: "F06",
    market: "futures",
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
  market: "futures",
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

describe("миграция 0007 (spec 0030): контекст входа, MAE, отсечённые сигналы", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "drizzle/0007_entry_context_mae_skipped.sql"),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  it("сделка прод-формата (без новых колонок) получает entry_context = {} и mae = null", async () => {
    const [run] = await db.insert(runs).values({}).returning();
    await db.execute(
      sql`insert into paper_trades (id, run_id, experiment_id, market, symbol, direction, opened_at, entry_price, quantity, atr, extreme, checked_until) values ('old', ${run.id}, 'F06', 'futures', 'BTCUSDT', 'long', now(), 100, 1, 1, 100, 0)`,
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
      market: "futures",
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
