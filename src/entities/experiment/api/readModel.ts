import {
  type Experiment,
  marketSchema,
  type PaperTrade,
  type SkippedSignal,
  skippedSignalSchema,
} from "@binance-dashboard/trading-core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { filterTrades, periodStart, sliceStats } from "../lib/slices";
import { computeStats, equityCurve } from "../lib/stats";
import { controlOf, variantLetters, variantsByControl } from "../lib/variants";
import { ASSET_GROUPS } from "../model/assetGroup";
import {
  type ExperimentRow,
  experimentsTable,
  paperTradesTable,
  runsTable,
  skippedSignalsTable,
} from "../model/db";
import { toDisabledInfo } from "../model/disable";
import {
  type DemoMirrorMode,
  mirrorAutoSnapshotSchema,
} from "../model/mirrorAuto";
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
  FamilyMember,
  RunParam,
  RunView,
} from "../model/view";
import { toTrade } from "./dbStore";
import {
  emptyMirrorSummary,
  type MirrorScope,
  mirrorStatuses,
  mirrorSummaries,
  toDemoSummary,
} from "./mirrorDb";

// Чтение для страниц лаборатории (только сервер): эксперименты и сделки выбранного периода со статистикой —
// текущая эпоха (по умолчанию), прошлая эпоха или все эпохи сразу (spec 0046). Эпоха — runs, текущая — с
// наибольшим id; сид и создание первой эпохи — ensureEngineReady.

type Db = PgDatabase<PgQueryResultHKT>;

/** Эпоха с границами: endedAt — начало следующей; null — текущая. */
interface RunRange {
  id: number;
  startedAt: Date;
  endedAt: Date | null;
}

/** Период выборки: одна эпоха или все. */
type Scope = RunRange | "all";

const runInfo = (r: RunRange) => ({
  id: r.id,
  startedAt: r.startedAt.toISOString(),
});

/**
 * Период страницы: запрошенная эпоха, all или текущая (run не задан). Несуществующая эпоха — текущая и missingRun
 * (страница пишет «эпохи нет»).
 */
async function resolveScope(
  db: Db,
  requested: RunParam | undefined,
): Promise<{
  scope: Scope;
  first: RunRange;
  view: RunView;
  mirrors: MirrorScope;
}> {
  const rows = await db.select().from(runsTable).orderBy(asc(runsTable.id));
  if (!rows.length) throw new Error("Эпоха учёта не создана");
  const runs: RunRange[] = rows.map((r, i) => ({
    id: r.id,
    startedAt: r.startedAt,
    endedAt: rows[i + 1]?.startedAt ?? null,
  }));
  const current = runs[runs.length - 1];
  const found =
    typeof requested === "number"
      ? runs.find((r) => r.id === requested)
      : undefined;
  const scope: Scope = requested === "all" ? "all" : (found ?? current);
  const missingRun = typeof requested === "number" && !found ? requested : null;
  return {
    scope,
    first: runs[0],
    view: {
      scope: scope === "all" ? "all" : scope.id,
      run: runInfo(scope === "all" ? current : scope),
      runs: runs.map(runInfo).reverse(),
      missingRun,
    },
    // Демо-сводка: текущая эпоха — с последнего демо-сброса (как раньше), прошлая — зеркала её сделок, all — все.
    mirrors:
      scope === "all"
        ? "all"
        : scope.id === current.id
          ? "current"
          : { runId: scope.id },
  };
}

/**
 * Сделки периода по возрастанию opened_at. Эпоха: учёт по отдельному сбросу эксперимента — только сделки не
 * раньше reset_at, если сброс был до конца эпохи (сброс в следующих эпохах её учёт не трогает; для текущей эпохи
 * это countedTrade). all — все сделки: отдельные сбросы эксперимента и группы историю не отсекают.
 */
async function scopeTrades(
  db: Db,
  scope: Scope,
  experiments: readonly Pick<ExperimentRow, "id" | "resetAt">[],
  experimentIds?: readonly string[],
): Promise<PaperTrade[]> {
  const rows = await db
    .select()
    .from(paperTradesTable)
    .where(
      and(
        scope === "all" ? undefined : eq(paperTradesTable.runId, scope.id),
        experimentIds === undefined
          ? undefined
          : inArray(paperTradesTable.experimentId, [...experimentIds]),
      ),
    )
    .orderBy(asc(paperTradesTable.openedAt));
  if (scope === "all") return rows.map(toTrade);
  const end = scope.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const resetOf = new Map(
    experiments.map((e) => [
      e.id,
      e.resetAt && e.resetAt.getTime() < end
        ? e.resetAt.getTime()
        : Number.NEGATIVE_INFINITY,
    ]),
  );
  return rows
    .filter(
      (r) =>
        r.openedAt.getTime() >=
        (resetOf.get(r.experimentId) ?? Number.NEGATIVE_INFINITY),
    )
    .map(toTrade);
}

function byExperiment(
  trades: readonly PaperTrade[],
): Map<string, PaperTrade[]> {
  const out = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    const list = out.get(t.experimentId);
    if (list) list.push(t);
    else out.set(t.experimentId, [t]);
  }
  return out;
}

/**
 * Все эксперименты каталога со статистикой периода (по умолчанию — текущей эпохи). Строки, не прошедшие схему,
 * пропускаются (onInvalid — в журнал), остальные показываются — так и во всех чтениях ниже.
 */
export async function readExperimentsOverview(
  db: Db,
  engineEnabled: boolean,
  demoConfigured = false,
  onInvalid?: OnInvalidExperiment,
  run?: RunParam,
): Promise<ExperimentsResponse> {
  const { scope, view, mirrors } = await resolveScope(db, run);
  const rows = await db
    .select()
    .from(experimentsTable)
    .orderBy(asc(experimentsTable.id));
  const [trades, demo] = await Promise.all([
    scopeTrades(db, scope, rows),
    mirrorSummaries(db, mirrors),
  ]);
  const tradesOf = byExperiment(trades);
  return {
    ...view,
    engineEnabled,
    demoConfigured,
    experiments: parseExperimentRows(rows, onInvalid).map(
      ({ experiment: e, row }) => {
        const auto = mirrorAutoSnapshotSchema.safeParse(row.demoMirrorAuto);
        return {
          id: e.id,
          market: e.market,
          name: e.name,
          hypothesis: e.hypothesis,
          initialBudget: e.initialBudget,
          enabled: e.enabled,
          demoMirror: e.demoMirror,
          demoMirrorMode: row.demoMirrorMode,
          demoMirrorAuto: auto.success ? auto.data : null,
          liveMirror: row.liveMirror,
          parentId: e.parentId ?? null,
          variantNote: e.variantNote ?? null,
          disabled: toDisabledInfo(row),
          stats: computeStats(tradesOf.get(e.id) ?? [], e.initialBudget),
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
 * Эксперимент, статистика, equity-кривая и последние limit сделок периода (по умолчанию — текущей эпохи), а для
 * контрольного и вариантов — метрики всей группы за тот же период (spec 0046). null — нет такого id или строка не
 * проходит схему (тогда onInvalid). В «Все эпохи» кривая склеена от начала первой эпохи; процент и просадка — от
 * текущего бюджета эксперимента (бюджет прошлых эпох не хранится).
 */
export async function readExperimentDetail(
  db: Db,
  id: string,
  engineEnabled: boolean,
  limit: number,
  onInvalid?: OnInvalidExperiment,
  run?: RunParam,
): Promise<ExperimentDetailResponse | null> {
  const rows = await db
    .select()
    .from(experimentsTable)
    .orderBy(asc(experimentsTable.id));
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const experiment = parseExperimentRow(row, onInvalid);
  if (!experiment) return null;

  // Группа «контрольный + варианты»: невалидные строки других экспериментов в неё не попадают.
  const parsed = parseExperimentRows(rows);
  const experiments = parsed.map((x) => x.experiment);
  const rowOf = new Map(parsed.map((x) => [x.experiment.id, x.row]));
  const byId = new Map(experiments.map((e) => [e.id, e]));
  const groups = variantsByControl(experiments);
  const control = experiment.parentId
    ? controlOf(experiment, byId)
    : groups.has(experiment.id)
      ? experiment
      : null;
  const variants = control ? (groups.get(control.id) ?? []) : [];
  const familyIds = control ? [control.id, ...variants.map((v) => v.id)] : [];

  const { scope, first, view, mirrors } = await resolveScope(db, run);
  const trades = await scopeTrades(db, scope, rows, [
    ...new Set([id, ...familyIds]),
  ]);
  const tradesOf = byExperiment(trades);
  const own = tradesOf.get(id) ?? [];
  const shown = own.slice(-limit).reverse();
  const [mirrorRows, demo] = await Promise.all([
    mirrorStatuses(
      db,
      shown.map((t) => t.id),
    ),
    mirrorSummaries(db, mirrors),
  ]);
  const letters = variantLetters(experiments);
  const member = (e: Experiment): FamilyMember => {
    const r = rowOf.get(e.id);
    return {
      id: e.id,
      name: e.name,
      market: e.market,
      enabled: e.enabled,
      disabled: r ? toDisabledInfo(r) : null,
      letter: letters.get(e.id) ?? null,
      variantNote: e.variantNote ?? null,
      config: e.config,
      stats: computeStats(tradesOf.get(e.id) ?? [], e.initialBudget),
    };
  };
  const startedAt = (scope === "all" ? first : scope).startedAt.toISOString();
  return {
    ...view,
    engineEnabled,
    experiment,
    disabled: toDisabledInfo(row),
    stats: computeStats(own, experiment.initialBudget),
    equity: equityCurve(own, experiment.initialBudget, startedAt),
    trades: shown,
    mirrors: Object.fromEntries(mirrorRows),
    demo: toDemoSummary(
      demo.get(id) ?? emptyMirrorSummary(),
      experiment.initialBudget,
    ),
    family: control
      ? { control: member(control), variants: variants.map(member) }
      : null,
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

/** Сколько отсечённых сигналов эксперимента с этой причиной записано в эпохе. */
export interface LabSkippedCount {
  experimentId: string;
  reason: string;
  count: number;
}

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
  /** Записано отсечённых сигналов за всю эпоху по эксперименту и причине — без учёта сброса: так считает лимит движка. */
  skippedCounts: LabSkippedCount[];
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
    skippedCounts: [
      ...skippedRows
        .reduce((counts, r) => {
          const key = `${r.experimentId}:${r.reason}`;
          counts.set(key, {
            experimentId: r.experimentId,
            reason: r.reason,
            count: (counts.get(key)?.count ?? 0) + 1,
          });
          return counts;
        }, new Map<string, LabSkippedCount>())
        .values(),
    ],
  };
}

/**
 * Тумблеры всех экспериментов — для `pnpm lab:apply` (сравнить «было → стало» перед записью): положение демо-зеркала
 * (spec 0043), связь варианта с контрольным и причина выключения — для проверки контрольного и смены причины (spec 0046).
 */
export async function readExperimentFlags(db: Db): Promise<
  (Pick<Experiment, "id" | "name" | "market" | "enabled" | "demoMirror"> & {
    demoMirrorMode: DemoMirrorMode;
    parentId: string | null;
    disabledReason: string | null;
    disabledNote: string | null;
  })[]
> {
  return db
    .select({
      id: experimentsTable.id,
      name: experimentsTable.name,
      market: experimentsTable.market,
      enabled: experimentsTable.enabled,
      demoMirror: experimentsTable.demoMirror,
      demoMirrorMode: experimentsTable.demoMirrorMode,
      parentId: experimentsTable.parentId,
      disabledReason: experimentsTable.disabledReason,
      disabledNote: experimentsTable.disabledNote,
    })
    .from(experimentsTable)
    .orderBy(asc(experimentsTable.id))
    .then((rows) =>
      rows.map((r) => ({ ...r, market: marketSchema.parse(r.market) })),
    );
}

/**
 * Разрезы /stats: сделки выбранного периода (по умолчанию текущей эпохи, all — всех эпох) под фильтры,
 * сгруппированные по эксперименту, рынку, монете или направлению. Несуществующая эпоха — текущая и missingRun.
 */
export async function readTradeStats(
  db: Db,
  query: StatsQuery,
  now: number,
  onInvalid?: OnInvalidExperiment,
): Promise<TradeStatsResponse> {
  const { scope, view } = await resolveScope(db, query.run);
  const rows = await db
    .select()
    .from(experimentsTable)
    .orderBy(asc(experimentsTable.id));
  const trades = await scopeTrades(db, scope, rows);
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
  // Капитал — только экспериментов под фильтры рынка и эксперимента (текущие бюджеты: прошлых эпох не хранятся).
  const funded = experiments.filter(
    (e) =>
      (query.market === undefined || e.market === query.market) &&
      (query.experiment === undefined || e.id === query.experiment),
  );
  const budget = funded.reduce((sum, e) => sum + e.initialBudget, 0);
  const names = new Map(experiments.map((e) => [e.id, e.name]));

  return {
    ...view,
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
