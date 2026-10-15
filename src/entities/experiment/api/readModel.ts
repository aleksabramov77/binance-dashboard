import {
  type Experiment,
  marketSchema,
  type PaperTrade,
  type SkippedSignal,
  skippedSignalSchema,
} from "@binance-dashboard/trading-core";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { filterTrades, periodStart, sliceStats } from "../lib/slices";
import { computeStats, equityCurve } from "../lib/stats";
import { ASSET_GROUPS } from "../model/assetGroup";
import {
  experimentsTable,
  paperTradesTable,
  runsTable,
  skippedSignalsTable,
} from "../model/db";
import {
  type OnInvalidExperiment,
  parseExperimentRow,
  parseExperimentRows,
} from "../model/parseRows";
import type {
  StatsGroupBy,
  StatsQuery,
  TradeStatsResponse,
} from "../model/statsView";
import type {
  ExperimentDetailResponse,
  ExperimentsResponse,
} from "../model/view";
import { countedTrade } from "./accounting";
import { toTrade } from "./dbStore";
import {
  emptyMirrorSummary,
  mirrorStatuses,
  mirrorSummaries,
  toDemoSummary,
} from "./mirrorDb";

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
        countedTrade(),
      ),
    )
    .orderBy(asc(paperTradesTable.openedAt));
  return rows.map(toTrade);
}

/**
 * Все эксперименты каталога со статистикой текущей эпохи. Строки, не прошедшие схему, пропускаются
 * (onInvalid — в журнал), остальные показываются — так и во всех чтениях ниже.
 */
export async function readExperimentsOverview(
  db: Db,
  engineEnabled: boolean,
  demoConfigured = false,
  onInvalid?: OnInvalidExperiment,
): Promise<ExperimentsResponse> {
  const run = await currentRun(db);
  const [rows, trades, demo] = await Promise.all([
    db.select().from(experimentsTable).orderBy(asc(experimentsTable.id)),
    runTrades(db, run.id),
    mirrorSummaries(db),
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
    demoConfigured,
    experiments: parseExperimentRows(rows, onInvalid).map(
      ({ experiment: e }) => {
        return {
          id: e.id,
          market: e.market,
          name: e.name,
          hypothesis: e.hypothesis,
          initialBudget: e.initialBudget,
          enabled: e.enabled,
          demoMirror: e.demoMirror,
          stats: computeStats(byExperiment.get(e.id) ?? [], e.initialBudget),
          demo: toDemoSummary(
            demo.get(e.id) ?? emptyMirrorSummary(),
            e.initialBudget,
          ),
        };
      },
    ),
  };
}

/**
 * Эксперимент, статистика, equity-кривая и последние limit сделок эпохи; null — нет такого id или
 * строка не проходит схему (тогда onInvalid).
 */
export async function readExperimentDetail(
  db: Db,
  id: string,
  engineEnabled: boolean,
  limit: number,
  onInvalid?: OnInvalidExperiment,
): Promise<ExperimentDetailResponse | null> {
  const [row] = await db
    .select()
    .from(experimentsTable)
    .where(eq(experimentsTable.id, id));
  if (!row) return null;
  const experiment = parseExperimentRow(row, onInvalid);
  if (!experiment) return null;
  const run = await currentRun(db);
  const trades = await runTrades(db, run.id, id);
  const shown = trades.slice(-limit).reverse();
  const [mirrors, demo] = await Promise.all([
    mirrorStatuses(
      db,
      shown.map((t) => t.id),
    ),
    mirrorSummaries(db),
  ]);
  return {
    run,
    engineEnabled,
    experiment,
    stats: computeStats(trades, experiment.initialBudget),
    equity: equityCurve(trades, experiment.initialBudget, run.startedAt),
    trades: shown,
    mirrors: Object.fromEntries(mirrors),
    demo: toDemoSummary(
      demo.get(id) ?? emptyMirrorSummary(),
      experiment.initialBudget,
    ),
  };
}

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
      return key in ASSET_GROUPS
        ? ASSET_GROUPS[key as keyof typeof ASSET_GROUPS].label
        : key;
    case "direction":
      return DIRECTION_LABELS[key as keyof typeof DIRECTION_LABELS] ?? key;
    case "symbol":
      return key;
  }
}

/** Эксперимент каталога плюс дата его отдельного сброса paper-учёта (null — не сбрасывался). */
export type LabExperiment = Experiment & { resetAt: string | null };

/** Эпоха отчёта лаборатории: endedAt — начало следующей эпохи; null — эпоха текущая. */
export interface LabRun {
  id: number;
  startedAt: string;
  endedAt: string | null;
}

/**
 * Эксперименты, учтённые сделки и отсечённые сигналы эпохи — для отчёта лаборатории (`pnpm lab:report`).
 * runId не задан — текущая эпоха; иначе — прошлая (`--run`), неизвестный id — ошибка со списком эпох.
 * Учёт по сбросу эксперимента — как countedTrade: сделки и сигналы не раньше reset_at; для прошлой эпохи
 * сброс учитывается, только если он был до её конца (сброс в следующих эпохах её учёт не трогает). Дата
 * сброса отдаётся, чтобы отчёт считал темп сделок и период эксперимента с неё. Конфиг экспериментов —
 * текущий: если его меняли после эпохи, отчёт по прошлой эпохе описывает новый конфиг.
 */
export async function readLabDataset(
  db: Db,
  onInvalid?: OnInvalidExperiment,
  runId?: number,
): Promise<{
  run: LabRun;
  experiments: LabExperiment[];
  trades: PaperTrade[];
  skipped: SkippedSignal[];
}> {
  const runs = await db.select().from(runsTable).orderBy(asc(runsTable.id));
  if (!runs.length) throw new Error("Эпоха учёта не создана");
  const index =
    runId === undefined
      ? runs.length - 1
      : runs.findIndex((r) => r.id === runId);
  if (index < 0)
    throw new Error(
      `эпохи ${runId} нет; есть: ${runs.map((r) => r.id).join(", ")}`,
    );
  const next = runs[index + 1];
  const run: LabRun = {
    id: runs[index].id,
    startedAt: runs[index].startedAt.toISOString(),
    endedAt: next ? next.startedAt.toISOString() : null,
  };
  const [rows, tradeRows, skippedRows] = await Promise.all([
    db.select().from(experimentsTable).orderBy(asc(experimentsTable.id)),
    db
      .select()
      .from(paperTradesTable)
      .where(eq(paperTradesTable.runId, run.id))
      .orderBy(asc(paperTradesTable.openedAt)),
    db
      .select()
      .from(skippedSignalsTable)
      .where(eq(skippedSignalsTable.runId, run.id))
      .orderBy(asc(skippedSignalsTable.at)),
  ]);
  const end = next?.startedAt.getTime() ?? Number.POSITIVE_INFINITY;
  const experiments = parseExperimentRows(rows, onInvalid).map(
    ({ experiment, row }) => ({
      ...experiment,
      resetAt:
        row.resetAt && row.resetAt.getTime() < end
          ? row.resetAt.toISOString()
          : null,
    }),
  );
  const resetOf = new Map(
    experiments.map((e) => [
      e.id,
      e.resetAt === null ? Number.NEGATIVE_INFINITY : Date.parse(e.resetAt),
    ]),
  );
  const counted = (experimentId: string, at: number) =>
    at >= (resetOf.get(experimentId) ?? Number.NEGATIVE_INFINITY);
  return {
    run,
    experiments,
    trades: tradeRows
      .filter((r) => counted(r.experimentId, r.openedAt.getTime()))
      .map(toTrade),
    skipped: skippedRows
      .filter((r) => counted(r.experimentId, r.at.getTime()))
      .flatMap((r) => {
        const parsed = skippedSignalSchema.safeParse({
          ...r,
          at: r.at.toISOString(),
        });
        return parsed.success ? [parsed.data] : [];
      }),
  };
}

/** Тумблеры всех экспериментов — для `pnpm lab:apply` (сравнить «было → стало» перед записью). */
export async function readExperimentFlags(
  db: Db,
): Promise<
  Pick<Experiment, "id" | "name" | "market" | "enabled" | "demoMirror">[]
> {
  return db
    .select({
      id: experimentsTable.id,
      name: experimentsTable.name,
      market: experimentsTable.market,
      enabled: experimentsTable.enabled,
      demoMirror: experimentsTable.demoMirror,
    })
    .from(experimentsTable)
    .orderBy(asc(experimentsTable.id))
    .then((rows) =>
      rows.map((r) => ({ ...r, market: marketSchema.parse(r.market) })),
    );
}

/**
 * Разрезы /stats: сделки выбранной (по умолчанию текущей) эпохи под фильтры, сгруппированные
 * по эксперименту, рынку, монете или направлению. null — нет такой эпохи.
 */
export async function readTradeStats(
  db: Db,
  query: StatsQuery,
  now: number,
  onInvalid?: OnInvalidExperiment,
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
  const experiments = parseExperimentRows(rows, onInvalid).map(
    (x) => x.experiment,
  );
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
