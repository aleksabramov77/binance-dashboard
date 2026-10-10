import { and, eq, isNotNull, isNull, sum } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { BudgetInputs } from "../lib/budgets";
import { experimentsTable, paperTradesTable } from "../model/db";
import { directionSchema, marketSchema } from "../model/schema";
import { ensureRun } from "./dbStore";

type Db = PgDatabase<PgQueryResultHKT>;

/** Данные для бюджетов текущей эпохи: стартовые капиталы, итоги закрытых сделок и открытые позиции. */
export async function loadBudgetInputs(
  db: Db,
): Promise<{ runId: number; inputs: BudgetInputs }> {
  const runId = await ensureRun(db);
  const [experiments, closed, open] = await Promise.all([
    db
      .select({
        market: experimentsTable.market,
        initialBudget: experimentsTable.initialBudget,
      })
      .from(experimentsTable),
    db
      .select({
        market: paperTradesTable.market,
        pnl: sum(paperTradesTable.pnl).mapWith(Number),
        fees: sum(paperTradesTable.fees).mapWith(Number),
      })
      .from(paperTradesTable)
      .where(
        and(
          eq(paperTradesTable.runId, runId),
          isNotNull(paperTradesTable.closedAt),
        ),
      )
      .groupBy(paperTradesTable.market),
    db
      .select({
        market: paperTradesTable.market,
        symbol: paperTradesTable.symbol,
        direction: paperTradesTable.direction,
        entryPrice: paperTradesTable.entryPrice,
        quantity: paperTradesTable.quantity,
      })
      .from(paperTradesTable)
      .where(
        and(
          eq(paperTradesTable.runId, runId),
          isNull(paperTradesTable.closedAt),
        ),
      ),
  ]);
  return {
    runId,
    inputs: {
      experiments: experiments.map((e) => ({
        ...e,
        market: marketSchema.parse(e.market),
      })),
      closed: closed.map((c) => ({
        market: marketSchema.parse(c.market),
        pnl: c.pnl ?? 0,
        fees: c.fees ?? 0,
      })),
      open: open.map((t) => ({
        ...t,
        market: marketSchema.parse(t.market),
        direction: directionSchema.parse(t.direction),
      })),
    },
  };
}
