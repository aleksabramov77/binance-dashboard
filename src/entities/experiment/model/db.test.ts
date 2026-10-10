import { desc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import {
  experimentsTable as experiments,
  paperTradesTable as paperTrades,
  runsTable as runs,
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
