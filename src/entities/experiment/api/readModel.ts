import {
  type Experiment,
  experimentSchema,
  type PaperTrade,
} from "@binance-dashboard/trading-core";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { computeStats, equityCurve } from "../lib/stats";
import { experimentsTable, paperTradesTable, runsTable } from "../model/db";
import type {
  ExperimentDetailResponse,
  ExperimentsResponse,
} from "../model/view";
import { toTrade } from "./dbStore";

// Чтение для страниц лаборатории (только сервер): эксперименты и сделки текущей эпохи
// со статистикой. Эпоха — runs с наибольшим id; сид и создание первой эпохи — ensureEngineReady.

type Db = PgDatabase<PgQueryResultHKT>;

async function currentRun(db: Db): Promise<ExperimentsResponse["run"]> {
  const [run] = await db
    .select()
    .from(runsTable)
    .orderBy(desc(runsTable.id))
    .limit(1);
  if (!run) throw new Error("Эпоха учёта не создана");
  return { id: run.id, startedAt: run.startedAt.toISOString() };
}

async function runTrades(
  db: Db,
  runId: number,
  experimentId?: string,
): Promise<PaperTrade[]> {
  const rows = await db
    .select()
    .from(paperTradesTable)
    .where(
      and(
        eq(paperTradesTable.runId, runId),
        experimentId === undefined
          ? undefined
          : eq(paperTradesTable.experimentId, experimentId),
      ),
    )
    .orderBy(asc(paperTradesTable.openedAt));
  return rows.map(toTrade);
}

/** Все эксперименты каталога со статистикой текущей эпохи. */
export async function readExperimentsOverview(
  db: Db,
  engineEnabled: boolean,
): Promise<ExperimentsResponse> {
  const run = await currentRun(db);
  const [rows, trades] = await Promise.all([
    db.select().from(experimentsTable).orderBy(asc(experimentsTable.id)),
    runTrades(db, run.id),
  ]);
  const byExperiment = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    const list = byExperiment.get(t.experimentId);
    if (list) list.push(t);
    else byExperiment.set(t.experimentId, [t]);
  }
  return {
    run,
    engineEnabled,
    experiments: rows.map((r) => {
      const e = experimentSchema.parse(r);
      return {
        id: e.id,
        market: e.market,
        name: e.name,
        hypothesis: e.hypothesis,
        initialBudget: e.initialBudget,
        enabled: e.enabled,
        stats: computeStats(byExperiment.get(e.id) ?? [], e.initialBudget),
      };
    }),
  };
}

/** Эксперимент, статистика, equity-кривая и последние limit сделок эпохи; null — нет такого id. */
export async function readExperimentDetail(
  db: Db,
  id: string,
  engineEnabled: boolean,
  limit: number,
): Promise<ExperimentDetailResponse | null> {
  const [row] = await db
    .select()
    .from(experimentsTable)
    .where(eq(experimentsTable.id, id));
  if (!row) return null;
  const experiment: Experiment = experimentSchema.parse(row);
  const run = await currentRun(db);
  const trades = await runTrades(db, run.id, id);
  return {
    run,
    engineEnabled,
    experiment,
    stats: computeStats(trades, experiment.initialBudget),
    equity: equityCurve(trades, experiment.initialBudget, run.startedAt),
    trades: trades.slice(-limit).reverse(),
  };
}
