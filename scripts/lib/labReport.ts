// Отчёт лаборатории для разбора экспериментов (`pnpm lab:report`, flow lab). Чистые функции: на входе —
// эксперименты и сделки эпохи, на выходе — метрики, разрезы и диагностика для скилла trading-lab
// (.claude/skills/trading-lab). Агрегаты PnL/PF/просадки — общие с /stats (entities/experiment).
import type {
  Experiment,
  ExperimentMarket,
  PaperTrade,
} from "@binance-dashboard/trading-core";
import {
  type ConfigLine,
  computeStats,
  describeConfig,
  filterTrades,
  groupStats,
  type TradeStats,
} from "@/entities/experiment";

const DAY = 86_400_000;
const MINUTE = 60_000;

/** Контрольные эксперименты рынка (catalog.ts): случайный вход и buy & hold BTC. */
export const CONTROLS: Record<
  ExperimentMarket,
  { random: string; hold: string }
> = {
  spot: { random: "S19", hold: "S20" },
  futures: { random: "F19", hold: "F20" },
};

/** Пороги выборки закрытых сделок (trading-lab → references/metrics.md). */
export const SAMPLE_THRESHOLDS = {
  preliminary: 30,
  decidable: 100,
  confident: 200,
} as const;

export type SampleLevel =
  | "insufficient"
  | "preliminary"
  | "decidable"
  | "confident";

export interface LabDataset {
  run: { id: number; startedAt: string };
  experiments: Experiment[];
  trades: PaperTrade[];
}

export interface LabReportOptions {
  /** Время отчёта, мс (снаружи — функции чистые). */
  now: number;
  /** Только эти эксперименты; пусто — все. */
  experimentIds?: string[];
  /** Начало периода, мс; null — вся эпоха. */
  since?: number | null;
}

/** Компактная строка разреза. */
export interface SliceRow {
  key: string;
  closed: number;
  winRate: number | null;
  pnl: number;
  avgR: number | null;
  avgReturnPct: number | null;
}

export interface MeanStat {
  n: number;
  mean: number | null;
  sd: number | null;
  /** mean / (sd / √n); null — меньше 2 значений или sd = 0. */
  t: number | null;
}

export interface MfeStats {
  /** Средний MFE в R прибыльных и убыточных закрытых сделок со стопом. */
  winnersAvgR: number | null;
  losersAvgR: number | null;
  /** Убыточные сделки, которые были в плюсе на ≥ 1R (отданная прибыль). */
  losersReached1R: number;
  losersWithStop: number;
}

export interface ExperimentReport {
  id: string;
  market: ExperimentMarket;
  name: string;
  hypothesis: string;
  enabled: boolean;
  demoMirror: boolean;
  config: ConfigLine[];
  stats: TradeStats;
  sample: SampleLevel;
  /** Ожидание в R по закрытым сделкам со стопом. */
  r: MeanStat;
  /** Доходность закрытой сделки, % от объёма входа (сравнима и без стопа). */
  returnPct: MeanStat;
  /** Средний выигрыш / средний проигрыш, USD; null — нет одной из сторон. */
  payoff: number | null;
  tradesPerDay: number;
  /** Дней до 30 и 100 закрытых при текущем темпе; 0 — уже есть; null — темп 0. */
  daysTo: { preliminary: number | null; decidable: number | null };
  avgHoldMinutes: number | null;
  mfe: MfeStats;
  /** Доля PnL от лучшей монеты и ожидание доходности без неё. */
  concentration: {
    topSymbol: string | null;
    /** PnL лучшей монеты, USD. */
    topPnl: number | null;
    /** Её доля в общем PnL; null — общий PnL ≤ 0. */
    topShare: number | null;
    avgReturnPctWithoutTop: number | null;
  };
  /** Разница средней доходности сделки с контролем «случайный вход» своего рынка, п. п. */
  vsRandomPct: number | null;
  byDirection: SliceRow[];
  byExitReason: SliceRow[];
  /** Час открытия UTC, блоками по 4 часа: «00–04» … «20–24». */
  byHourUtc: SliceRow[];
  /** Лучшие и худшие монеты по PnL (до 5 каждой стороны). */
  bestSymbols: SliceRow[];
  worstSymbols: SliceRow[];
  /** Подозрительные метрики — сначала искать ошибку (references/metrics.md). */
  flags: string[];
}

export interface LabReport {
  generatedAt: string;
  run: { id: number; startedAt: string };
  periodStart: string;
  periodDays: number;
  experiments: ExperimentReport[];
}

type ClosedTrade = PaperTrade & { closedAt: string; pnl: number };

const isClosed = (t: PaperTrade): t is ClosedTrade =>
  t.closedAt !== null && t.pnl !== null;

/** `--since`: «7d», «24h» → now − период; иначе дата ISO. */
export function parseSince(value: string, now: number): number {
  const m = /^(\d+)([hd])$/.exec(value);
  if (m) return now - Number(m[1]) * (m[2] === "h" ? 3_600_000 : DAY);
  const at = Date.parse(value);
  if (Number.isNaN(at)) throw new Error(`--since: не понял «${value}»`);
  return at;
}

/** Среднее, стандартное отклонение (выборочное) и t-статистика. */
export function meanStat(values: number[]): MeanStat {
  const n = values.length;
  if (n === 0) return { n, mean: null, sd: null, t: null };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { n, mean, sd: null, t: null };
  const sd = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1),
  );
  return { n, mean, sd, t: sd > 0 ? mean / (sd / Math.sqrt(n)) : null };
}

export function sampleLevel(closed: number): SampleLevel {
  if (closed >= SAMPLE_THRESHOLDS.confident) return "confident";
  if (closed >= SAMPLE_THRESHOLDS.decidable) return "decidable";
  if (closed >= SAMPLE_THRESHOLDS.preliminary) return "preliminary";
  return "insufficient";
}

/** Доходность сделки в % от объёма входа (pnl уже за вычетом комиссий). */
export function returnPct(t: ClosedTrade): number {
  const notional = t.entryPrice * t.quantity;
  return notional > 0 ? (t.pnl / notional) * 100 : 0;
}

/**
 * MFE в R: лучшая цена с входа относительно риска до начального стопа; null — без стопа. Нижняя оценка:
 * walkExits обновляет extreme после проверки выхода, поэтому свеча выхода учтена только ценой выхода.
 */
export function mfeR(t: PaperTrade): number | null {
  if (t.initialStop === null) return null;
  const risk = Math.abs(t.entryPrice - t.initialStop);
  if (risk === 0) return null;
  const sign = t.direction === "long" ? 1 : -1;
  const best = Math.max(
    sign * (t.extreme - t.entryPrice),
    t.exitPrice === null
      ? Number.NEGATIVE_INFINITY
      : sign * (t.exitPrice - t.entryPrice),
  );
  return best / risk;
}

const avg = (values: number[]): number | null =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

function sliceRows(
  trades: ClosedTrade[],
  keyOf: (t: ClosedTrade) => string,
): SliceRow[] {
  return groupStats(trades, keyOf)
    .map((g) => ({
      key: g.key,
      closed: g.stats.closed,
      winRate: g.stats.winRate,
      pnl: g.stats.realizedPnl,
      avgR: g.stats.avgR,
      avgReturnPct: avg(
        trades.filter((t) => keyOf(t) === g.key).map(returnPct),
      ),
    }))
    .sort((a, b) => b.pnl - a.pnl);
}

const hourBucket = (iso: string): string => {
  const from = Math.floor(new Date(iso).getUTCHours() / 4) * 4;
  const pad = (h: number) => String(h).padStart(2, "0");
  return `${pad(from)}–${pad(from + 4)}`;
};

function mfeStats(closed: ClosedTrade[]): MfeStats {
  const withMfe = closed
    .map((t) => ({ t, mfe: mfeR(t) }))
    .filter((x): x is { t: ClosedTrade; mfe: number } => x.mfe !== null);
  const winners = withMfe.filter((x) => x.t.pnl > 0);
  const losers = withMfe.filter((x) => x.t.pnl <= 0);
  return {
    winnersAvgR: avg(winners.map((x) => x.mfe)),
    losersAvgR: avg(losers.map((x) => x.mfe)),
    losersReached1R: losers.filter((x) => x.mfe >= 1).length,
    losersWithStop: losers.length,
  };
}

function concentration(
  closed: ClosedTrade[],
): ExperimentReport["concentration"] {
  const rows = sliceRows(closed, (t) => t.symbol);
  const top = rows[0];
  const total = closed.reduce((s, t) => s + t.pnl, 0);
  if (!top || top.pnl <= 0)
    return {
      topSymbol: null,
      topPnl: null,
      topShare: null,
      avgReturnPctWithoutTop: null,
    };
  return {
    topSymbol: top.key,
    topPnl: top.pnl,
    topShare: total > 0 ? top.pnl / total : null,
    avgReturnPctWithoutTop: avg(
      closed.filter((t) => t.symbol !== top.key).map(returnPct),
    ),
  };
}

function suspiciousFlags(
  e: Experiment,
  stats: TradeStats,
  closed: ClosedTrade[],
): string[] {
  const flags: string[] = [];
  if (
    stats.closed >= SAMPLE_THRESHOLDS.preliminary &&
    (stats.winRate ?? 0) > 0.9 &&
    stats.maxDrawdownPct < 0.05
  )
    flags.push("win rate > 90% при просадке < 5%");
  if (stats.closed >= SAMPLE_THRESHOLDS.preliminary && stats.losses === 0)
    flags.push("нет убыточных сделок на 30+ закрытых");
  if (
    stats.closed >= SAMPLE_THRESHOLDS.preliminary &&
    stats.profitFactor !== null &&
    stats.profitFactor > 5
  )
    flags.push("profit factor > 5 на 30+ закрытых");
  const tp = e.config.exit.takeProfit;
  if (tp?.type === "rr") {
    const over = closed.filter(
      (t) =>
        t.exitReason === "tp" &&
        t.rMultiple !== null &&
        t.rMultiple > tp.r + 0.25,
    ).length;
    if (over > 0) flags.push(`${over} сделок по tp с R выше цели ${tp.r}R`);
  }
  const instant = closed.filter(
    (t) =>
      (t.exitReason === "tp" || t.exitReason === "sl") &&
      Math.floor(Date.parse(t.closedAt) / MINUTE) <=
        Math.floor(Date.parse(t.openedAt) / MINUTE),
  ).length;
  if (instant > 0)
    flags.push(`${instant} сделок закрыты по tp/sl в минуту входа`);
  return flags;
}

function daysTo(target: number, closed: number, perDay: number): number | null {
  if (closed >= target) return 0;
  return perDay > 0 ? (target - closed) / perDay : null;
}

/** Отчёт по экспериментам эпохи (или периоду), отсортированный по средней доходности сделки. */
export function buildLabReport(
  data: LabDataset,
  opts: LabReportOptions,
): LabReport {
  const runStart = Date.parse(data.run.startedAt);
  const start = Math.max(runStart, opts.since ?? runStart);
  const periodDays = Math.max((opts.now - start) / DAY, 1 / 24);
  const trades = filterTrades(data.trades, {
    since: opts.since ?? null,
  });
  const ids = opts.experimentIds?.length ? new Set(opts.experimentIds) : null;

  const byExperiment = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    const list = byExperiment.get(t.experimentId) ?? [];
    list.push(t);
    byExperiment.set(t.experimentId, list);
  }
  const avgReturnOf = (id: string): number | null =>
    avg((byExperiment.get(id) ?? []).filter(isClosed).map(returnPct));

  const experiments = data.experiments
    .filter((e) => ids === null || ids.has(e.id))
    .map((e): ExperimentReport => {
      const own = byExperiment.get(e.id) ?? [];
      const closed = own.filter(isClosed);
      const stats = computeStats(own, e.initialBudget);
      const ret = meanStat(closed.map(returnPct));
      const wins = closed.filter((t) => t.pnl > 0).map((t) => t.pnl);
      const losses = closed.filter((t) => t.pnl < 0).map((t) => -t.pnl);
      const avgWin = avg(wins);
      const avgLoss = avg(losses);
      const perDay = stats.closed / periodDays;
      const randomId = CONTROLS[e.market].random;
      const randomAvg = e.id === randomId ? null : avgReturnOf(randomId);
      const sortedBySymbol = sliceRows(closed, (t) => t.symbol);
      return {
        id: e.id,
        market: e.market,
        name: e.name,
        hypothesis: e.hypothesis,
        enabled: e.enabled,
        demoMirror: e.demoMirror,
        config: describeConfig(e.config),
        stats,
        sample: sampleLevel(stats.closed),
        r: meanStat(
          closed.map((t) => t.rMultiple).filter((r): r is number => r !== null),
        ),
        returnPct: ret,
        payoff:
          avgWin !== null && avgLoss !== null && avgLoss > 0
            ? avgWin / avgLoss
            : null,
        tradesPerDay: perDay,
        daysTo: {
          preliminary: daysTo(
            SAMPLE_THRESHOLDS.preliminary,
            stats.closed,
            perDay,
          ),
          decidable: daysTo(SAMPLE_THRESHOLDS.decidable, stats.closed, perDay),
        },
        avgHoldMinutes: avg(
          closed.map(
            (t) => (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / MINUTE,
          ),
        ),
        mfe: mfeStats(closed),
        concentration: concentration(closed),
        vsRandomPct:
          ret.mean !== null && randomAvg !== null ? ret.mean - randomAvg : null,
        byDirection: sliceRows(closed, (t) => t.direction),
        byExitReason: sliceRows(closed, (t) => t.exitReason ?? "—"),
        byHourUtc: sliceRows(closed, (t) => hourBucket(t.openedAt)).sort(
          (a, b) => a.key.localeCompare(b.key),
        ),
        bestSymbols: sortedBySymbol.filter((r) => r.pnl > 0).slice(0, 5),
        worstSymbols: sortedBySymbol
          .filter((r) => r.pnl < 0)
          .slice(-5)
          .reverse(),
        flags: suspiciousFlags(e, stats, closed),
      };
    })
    .sort(
      (a, b) =>
        (b.returnPct.mean ?? Number.NEGATIVE_INFINITY) -
        (a.returnPct.mean ?? Number.NEGATIVE_INFINITY),
    );

  return {
    generatedAt: new Date(opts.now).toISOString(),
    run: data.run,
    periodStart: new Date(start).toISOString(),
    periodDays,
    experiments,
  };
}

// --- Markdown ---

const SAMPLE_LABEL: Record<SampleLevel, string> = {
  insufficient: "мало данных",
  preliminary: "предварительно",
  decidable: "можно решать",
  confident: "уверенно",
};

const num = (v: number | null, digits = 2): string =>
  v === null ? "—" : v.toFixed(digits);
const pct = (v: number | null, digits = 0): string =>
  v === null ? "—" : `${(v * 100).toFixed(digits)}%`;
const usd = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const days = (v: number | null): string =>
  v === null ? "∞" : v === 0 ? "есть" : `${Math.ceil(v)} дн.`;

function sliceTable(title: string, rows: SliceRow[]): string[] {
  if (!rows.length) return [];
  return [
    `**${title}**`,
    "",
    "| | Закрыто | Win | PnL $ | avg R | Доходн. % |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.key} | ${r.closed} | ${pct(r.winRate)} | ${usd(r.pnl)} | ${num(r.avgR)} | ${num(r.avgReturnPct, 3)} |`,
    ),
    "",
  ];
}

function experimentSection(e: ExperimentReport): string[] {
  const s = e.stats;
  const head = `### ${e.id} · ${e.name}${e.enabled ? "" : " (выключен)"}${e.demoMirror ? " · демо-зеркало" : ""}`;
  if (s.closed === 0)
    return [
      head,
      "",
      `Гипотеза: ${e.hypothesis}`,
      "",
      `Закрытых сделок нет (открыто ${s.open}).`,
      "",
    ];
  return [
    head,
    "",
    `Гипотеза: ${e.hypothesis}`,
    "",
    ...e.config.map((c) => `- ${c.label}: ${c.value}`),
    "",
    `Выборка: ${s.closed} закрытых (${SAMPLE_LABEL[e.sample]}), открыто ${s.open}; ${num(e.tradesPerDay, 1)} сделок/день; до 30 — ${days(e.daysTo.preliminary)}, до 100 — ${days(e.daysTo.decidable)}.`,
    `Результат: PnL ${usd(s.realizedPnl)} $, win rate ${pct(s.winRate)}, PF ${num(s.profitFactor)}, payoff ${num(e.payoff)}, просадка ${pct(s.maxDrawdownPct, 1)}.`,
    `Ожидание: R ${num(e.r.mean)} (sd ${num(e.r.sd)}, t ${num(e.r.t)}, n ${e.r.n}); доходность ${num(e.returnPct.mean, 3)}% (t ${num(e.returnPct.t)}); к случайному входу рынка ${e.vsRandomPct === null ? "—" : `${e.vsRandomPct >= 0 ? "+" : ""}${e.vsRandomPct.toFixed(3)} п. п.`}`,
    `Удержание: ${e.avgHoldMinutes === null ? "—" : `${Math.round(e.avgHoldMinutes)} мин`}. MFE: прибыльные ${num(e.mfe.winnersAvgR)}R, убыточные ${num(e.mfe.losersAvgR)}R; убыточных с MFE ≥ 1R — ${e.mfe.losersReached1R} из ${e.mfe.losersWithStop}.`,
    e.concentration.topSymbol
      ? `Концентрация: ${e.concentration.topSymbol} — ${usd(e.concentration.topPnl ?? 0)} $ (${e.concentration.topShare === null ? "при общем PnL ≤ 0" : `${pct(e.concentration.topShare)} PnL`}); без неё доходность ${num(e.concentration.avgReturnPctWithoutTop, 3)}%.`
      : "Концентрация: прибыльных монет нет.",
    ...(e.flags.length ? ["", `⚠️ Подозрительно: ${e.flags.join("; ")}.`] : []),
    "",
    ...sliceTable("Направление", e.byDirection),
    ...sliceTable("Причина выхода", e.byExitReason),
    ...sliceTable("Час открытия, UTC", e.byHourUtc),
    ...sliceTable("Лучшие монеты", e.bestSymbols),
    ...sliceTable("Худшие монеты", e.worstSymbols),
  ];
}

export function renderLabReport(report: LabReport): string {
  const rows = report.experiments.map(
    (e) =>
      `| ${e.id} | ${e.name} | ${e.market} | ${e.stats.closed} | ${SAMPLE_LABEL[e.sample]} | ${usd(e.stats.realizedPnl)} | ${pct(e.stats.winRate)} | ${num(e.stats.profitFactor)} | ${num(e.r.mean)} | ${num(e.r.t)} | ${num(e.returnPct.mean, 3)} | ${e.flags.length ? "⚠️" : ""} |`,
  );
  return [
    "# Отчёт лаборатории",
    "",
    `Сформирован ${report.generatedAt}. Эпоха #${report.run.id} с ${report.run.startedAt}; период с ${report.periodStart} (${num(report.periodDays, 1)} дн.).`,
    "Только закрытые сделки текущего учёта; PnL — за вычетом комиссий и слиппеджа. Как читать — скилл trading-lab.",
    `Контроль: spot — ${CONTROLS.spot.random} (случайный вход), ${CONTROLS.spot.hold} (hold BTC); futures — ${CONTROLS.futures.random}, ${CONTROLS.futures.hold}.`,
    "",
    "## Сводка (по средней доходности сделки)",
    "",
    "| id | Эксперимент | Рынок | Закрыто | Выборка | PnL $ | Win | PF | avg R | t(R) | Доходн. % | |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Эксперименты",
    "",
    ...report.experiments.flatMap(experimentSection),
  ].join("\n");
}
