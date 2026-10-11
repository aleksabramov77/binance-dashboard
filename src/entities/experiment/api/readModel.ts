import {
  type Experiment,
  experimentSchema,
  type PaperTrade,
} from "@binance-dashboard/trading-core";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { filterTrades, periodStart, sliceStats } from "../lib/slices";
import { computeStats, equityCurve } from "../lib/stats";
import { experimentsTable, paperTradesTable, runsTable } from "../model/db";
import type {
  StatsGroupBy,
  StatsQuery,
  TradeStatsResponse,
} from "../model/statsView";
import type {
  ExperimentDetailResponse,
  ExperimentsResponse,
} from "../model/view";
import { toTrade } from "./dbStore";
import { mirrorStatuses } from "./mirrorDb";

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
  const shown = trades.slice(-limit).reverse();
  const mirrors = await mirrorStatuses(
    db,
    shown.map((t) => t.id),
  );
  return {
    run,
    engineEnabled,
    experiment,
    stats: computeStats(trades, experiment.initialBudget),
    equity: equityCurve(trades, experiment.initialBudget, run.startedAt),
    trades: shown,
    mirrors: Object.fromEntries(mirrors),
  };
}

const MARKET_LABELS = { spot: "Spot", futures: "Futures" } as const;
const DIRECTION_LABELS = { long: "Long (B)", short: "Short (S)" } as const;

function groupLabel(
  groupBy: StatsGroupBy,
  key: string,
  names: Map<string, string>,
): string {
  switch (groupBy) {
    case "experiment": {
      const name = names.get(key);
      return name ? `${key} · ${name}` : key;
    }
    case "market":
      return MARKET_LABELS[key as keyof typeof MARKET_LABELS] ?? key;
    case "direction":
      return DIRECTION_LABELS[key as keyof typeof DIRECTION_LABELS] ?? key;
    case "symbol":
      return key;
  }
}

/**
 * Разрезы /stats: сделки выбранной (по умолчанию текущей) эпохи под фильтры, сгруппированные
 * по эксперименту, рынку, монете или направлению. null — нет такой эпохи.
 */
export async function readTradeStats(
  db: Db,
  query: StatsQuery,
  now: number,
): Promise<TradeStatsResponse | null> {
  const runs = (
    await db.select().from(runsTable).orderBy(desc(runsTable.id))
  ).map((r) => ({ id: r.id, startedAt: r.startedAt.toISOString() }));
  if (!runs.length) throw new Error("Эпоха учёта не создана");
  const run =
    query.run === undefined ? runs[0] : runs.find((r) => r.id === query.run);
  if (!run) return null;

  const [rows, trades] = await Promise.all([
    db.select().from(experimentsTable).orderBy(asc(experimentsTable.id)),
    runTrades(db, run.id),
  ]);
  const experiments = rows.map((r) => experimentSchema.parse(r));
  const since = periodStart(query.period, now);
  const filtered = filterTrades(trades, {
    market: query.market,
    experiment: query.experiment,
    direction: query.direction,
    symbol: query.symbol,
    since,
  });
  // Капитал — только экспериментов под фильтры рынка и эксперимента.
  const funded = experiments.filter(
    (e) =>
      (query.market === undefined || e.market === query.market) &&
      (query.experiment === undefined || e.id === query.experiment),
  );
  const budget = funded.reduce((sum, e) => sum + e.initialBudget, 0);
  const names = new Map(experiments.map((e) => [e.id, e.name]));

  return {
    run,
    runs,
    query,
    since: since === null ? null : new Date(since).toISOString(),
    total: computeStats(filtered, budget),
    groups: sliceStats(filtered, query.groupBy, funded).map((g) => ({
      ...g,
      label: groupLabel(query.groupBy, g.key, names),
    })),
    options: {
      experiments: experiments.map((e) => ({
        id: e.id,
        name: e.name,
        market: e.market,
      })),
      symbols: [...new Set(trades.map((t) => t.symbol))].sort(),
    },
  };
}
