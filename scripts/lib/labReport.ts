// Отчёт лаборатории для разбора экспериментов (`pnpm lab:report`, flow lab). Чистые функции: на входе —
// эксперименты и сделки эпохи (+ контекст рынка), на выходе — метрики, разрезы, семейства, подсказки и
// markdown/CSV для агента quant и скилла trading-lab (.claude/skills/trading-lab). Агрегаты PnL/PF/просадки —
// общие с /stats (entities/experiment). Считается всегда по всем экспериментам: семействам, архетипам и контролю
// нужны соседи; «фокус» лишь выбирает, по каким экспериментам писать подробные разделы.
import {
  type EntryRule,
  type ExperimentMarket,
  MARKETS,
  type PaperTrade,
  TIMEFRAME_MS,
} from "@binance-dashboard/trading-core";
import {
  type ConfigLine,
  computeStats,
  describeConfig,
  describeEntry,
  filterTrades,
  groupStats,
  type LabExperiment,
  type TradeStats,
} from "@/entities/experiment";
import { describeMarket, type MarketContext } from "./labMarket";

const DAY = 86_400_000;
const MINUTE = 60_000;

/** Пороги выборки закрытых сделок (trading-lab → references/metrics.md). */
export const SAMPLE_THRESHOLDS = {
  preliminary: 30,
  decidable: 100,
  confident: 200,
} as const;

/** Пороги механических подсказок о причине результата (trading-lab → references/failure-modes.md). */
export const HINT_RULES = {
  /** Меньше закрытых сделок — подсказки о выходах/направлении/концентрации не считаются. */
  minClosed: 10,
  /** Доля убыточных со стопом, побывавших в плюсе ≥ 1R. */
  giveBackShare: 0.25,
  /** Прибыльные удерживают меньше этой доли своего MFE (реализованный R / MFE в R). */
  cutWinnersKeepShare: 0.5,
  /** Доля стопов, сработавших раньше одной свечи ТФ. */
  stopInNoiseShare: 0.5,
  /** Доля PnL от одной монеты или одной сделки. */
  concentrationShare: 0.5,
  /** Дней до 30 закрытых при текущем темпе — сигнал редкий. */
  rareSignalDays: 30,
  /** |t| ниже — перевес неотличим от нуля. */
  noEdgeT: 1,
  /** t не выше — вход устойчиво против (кандидат на инверсию). */
  negativeEdgeT: -2,
} as const;

/** Пороги флагов «подозрительно хорошо» — сначала искать ошибку (references/metrics.md). */
export const FLAG_RULES = {
  minClosed: SAMPLE_THRESHOLDS.preliminary,
  winRate: 0.9,
  profitFactor: 5,
  /** На сколько R выход по tp может превышать цель из-за округлений. */
  overTargetR: 0.25,
} as const;

export type SampleLevel =
  | "insufficient"
  | "preliminary"
  | "decidable"
  | "confident";

export type Archetype = "trend" | "breakout" | "meanReversion" | "control";

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  trend: "тренд",
  breakout: "пробой",
  meanReversion: "возврат к среднему",
  control: "контроль",
};

const ARCHETYPE_OF: Record<EntryRule["type"], Archetype> = {
  emaCross: "trend",
  supertrend: "trend",
  macd: "trend",
  emaPullback: "trend",
  momentum: "trend",
  donchian: "breakout",
  bbSqueeze: "breakout",
  volumeSpike: "breakout",
  rsi2: "meanReversion",
  bbReversion: "meanReversion",
  counterTrend: "meanReversion",
  funding: "meanReversion",
  random: "control",
  hold: "control",
};

/** Архетип входа: продолжение пампа — ставка на тренд, остальной сканер — контртренд. */
export function archetypeOf(entry: EntryRule): Archetype {
  if (entry.type === "counterTrend" && entry.mode === "pumpContinuation")
    return "trend";
  return ARCHETYPE_OF[entry.type];
}

export type Hint =
  | "no-edge"
  | "negative-edge"
  | "exit-cuts-winners"
  | "exit-gives-back"
  | "stop-in-noise"
  | "costs"
  | "direction"
  | "rare-signal"
  | "concentration"
  | "engine";

export interface LabDataset {
  run: { id: number; startedAt: string };
  experiments: LabExperiment[];
  trades: PaperTrade[];
}

export interface LabReportOptions {
  /** Время отчёта, мс (снаружи — функции чистые). */
  now: number;
  /** Фокус: подробные разделы только по этим id; расчёты — по всем. Неизвестный id — ошибка. */
  focus?: string[];
  /** Начало периода, мс; null — вся эпоха. */
  since?: number | null;
  /** Контекст рынка; null — не загружен (`--no-market` или сеть). */
  market?: MarketContext | null;
  /** К какой БД подключались (describeDatabase) — в шапку отчёта. */
  database?: string;
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
  /** Реализованный средний R прибыльных — для сравнения с их MFE. */
  winnersRealizedAvgR: number | null;
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
  archetype: Archetype;
  config: ConfigLine[];
  /** Начало учёта эксперимента в отчёте: старт периода или его отдельный сброс, если он позже. */
  accountedFrom: string;
  /** Дней учёта эксперимента (темп сделок считается по ним). */
  periodDays: number;
  /** Дата отдельного сброса paper-учёта; null — не сбрасывался. */
  resetAt: string | null;
  stats: TradeStats;
  /** PnL до вычета комиссий, USD — сколько съели издержки. */
  pnlBeforeFees: number;
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
  /** То же в свечах таймфрейма эксперимента. */
  avgHoldBars: number | null;
  /** Доля стопов, сработавших раньше одной свечи ТФ. */
  stopsInFirstBarShare: number | null;
  mfe: MfeStats;
  /** Доля PnL от лучшей монеты и от крупнейшей сделки; ожидание без лучшей монеты. */
  concentration: {
    topSymbol: string | null;
    /** PnL лучшей монеты, USD. */
    topPnl: number | null;
    /** Её доля в общем PnL; null — общий PnL ≤ 0. */
    topShare: number | null;
    /** Доля крупнейшей прибыльной сделки в общем PnL; null — общий PnL ≤ 0. */
    topTradeShare: number | null;
    avgReturnPctWithoutTop: number | null;
  };
  /** Разница средней доходности сделки с контролем «случайный вход» своего рынка, п. п.; null — контроля нет. */
  vsRandomPct: number | null;
  byDirection: SliceRow[];
  byExitReason: SliceRow[];
  /** Час открытия UTC, блоками по 4 часа: «00–04» … «20–24». */
  byHourUtc: SliceRow[];
  /** UTC-день закрытия. */
  byDay: SliceRow[];
  /** Будни / выходные по дню открытия (UTC). */
  byWeekpart: SliceRow[];
  /** Лучшие и худшие монеты по PnL (до 5 каждой стороны). */
  bestSymbols: SliceRow[];
  worstSymbols: SliceRow[];
  /** Подозрительные метрики — сначала искать ошибку (references/metrics.md). */
  flags: string[];
  /** Механические подсказки о причине результата — агент проверяет, а не повторяет. */
  hints: Hint[];
}

export interface FamilyMember {
  id: string;
  market: ExperimentMarket;
  name: string;
  /** Чем отличается от остальных в семействе: строки конфига, которые не совпадают. */
  variant: string;
  closed: number;
  pnl: number;
  avgR: number | null;
  tR: number | null;
  avgReturnPct: number | null;
}

/** Эксперименты с одним входом и таймфреймом, но разными выходами, юниверсом, направлением или рынком. */
export interface Family {
  key: string;
  label: string;
  members: FamilyMember[];
}

export interface ArchetypeRow {
  market: ExperimentMarket;
  archetype: Archetype;
  experiments: number;
  closed: number;
  pnl: number;
  avgReturnPct: number | null;
  avgR: number | null;
}

export type Controls = Record<
  ExperimentMarket,
  { random: string | null; hold: string | null }
>;

export interface LabReport {
  generatedAt: string;
  database: string | null;
  run: { id: number; startedAt: string };
  periodStart: string;
  periodDays: number;
  /** id экспериментов фокуса (подробные разделы); пусто — все. */
  focus: string[];
  controls: Controls;
  market: MarketContext | null;
  archetypes: ArchetypeRow[];
  families: Family[];
  experiments: ExperimentReport[];
  /** Единицы полей JSON — чтобы агент не путал доли и проценты. */
  legend: string;
}

export const LEGEND =
  "Доли (0,05 = 5 %): winRate, maxDrawdownPct, topShare, topTradeShare, stopsInFirstBarShare, " +
  "market.periodMaxDrawdownPct. Проценты (0,5 = 0,5 %): returnPct, avgReturnPct, avgReturnPctWithoutTop, " +
  "vsRandomPct (п. п.), market.periodReturnPct, market.atrPct14_4h, market.daily.returnPct. " +
  "R — кратные риска до начального стопа. USD: pnl, realizedPnl, pnlBeforeFees, fees, maxDrawdown.";

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

/** Контрольные эксперименты каждого рынка — по типу входа, а не по зашитым id. */
export function controlsOf(
  experiments: Pick<LabExperiment, "id" | "market" | "config">[],
): Controls {
  const controls: Controls = {
    spot: { random: null, hold: null },
    usdm: { random: null, hold: null },
    coinm: { random: null, hold: null },
  };
  for (const e of experiments) {
    const type = e.config.entry.type;
    if (type === "random" || type === "hold") controls[e.market][type] ??= e.id;
  }
  return controls;
}

const holdMs = (t: ClosedTrade) =>
  Date.parse(t.closedAt) - Date.parse(t.openedAt);

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

const dayOf = (iso: string): string => iso.slice(0, 10);

const weekpart = (iso: string): string => {
  const day = new Date(iso).getUTCDay();
  return day === 0 || day === 6 ? "выходные" : "будни";
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
    winnersRealizedAvgR: avg(
      winners.map((x) => x.t.rMultiple).filter((r): r is number => r !== null),
    ),
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
  const share = (part: number) => (total > 0 ? part / total : null);
  const topTrade = Math.max(0, ...closed.map((t) => t.pnl));
  if (!top || top.pnl <= 0)
    return {
      topSymbol: null,
      topPnl: null,
      topShare: null,
      topTradeShare: topTrade > 0 ? share(topTrade) : null,
      avgReturnPctWithoutTop: null,
    };
  return {
    topSymbol: top.key,
    topPnl: top.pnl,
    topShare: share(top.pnl),
    topTradeShare: share(topTrade),
    avgReturnPctWithoutTop: avg(
      closed.filter((t) => t.symbol !== top.key).map(returnPct),
    ),
  };
}

function suspiciousFlags(
  e: LabExperiment,
  stats: TradeStats,
  closed: ClosedTrade[],
): string[] {
  const flags: string[] = [];
  const enough = stats.closed >= FLAG_RULES.minClosed;
  if (enough && (stats.winRate ?? 0) > FLAG_RULES.winRate)
    flags.push(
      `win rate > ${FLAG_RULES.winRate * 100}% на ${FLAG_RULES.minClosed}+ закрытых`,
    );
  if (enough && stats.losses === 0)
    flags.push(`нет убыточных сделок на ${FLAG_RULES.minClosed}+ закрытых`);
  if (
    enough &&
    stats.profitFactor !== null &&
    stats.profitFactor > FLAG_RULES.profitFactor
  )
    flags.push(
      `profit factor > ${FLAG_RULES.profitFactor} на ${FLAG_RULES.minClosed}+ закрытых`,
    );
  const tp = e.config.exit.takeProfit;
  if (tp?.type === "rr") {
    const over = closed.filter(
      (t) =>
        t.exitReason === "tp" &&
        t.rMultiple !== null &&
        t.rMultiple > tp.r + FLAG_RULES.overTargetR,
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

type HintInput = Pick<
  ExperimentReport,
  | "archetype"
  | "stats"
  | "pnlBeforeFees"
  | "returnPct"
  | "vsRandomPct"
  | "mfe"
  | "stopsInFirstBarShare"
  | "byDirection"
  | "daysTo"
  | "concentration"
  | "flags"
>;

/** Подсказки по порогам HINT_RULES; порядок — от причины во входе к причинам в учёте. */
export function hintsOf(r: HintInput): Hint[] {
  const hints: Hint[] = [];
  const { stats, mfe } = r;
  const enough = stats.closed >= HINT_RULES.minClosed;
  const t = r.returnPct.t;
  if (stats.closed >= SAMPLE_THRESHOLDS.preliminary && t !== null) {
    if (t <= HINT_RULES.negativeEdgeT) hints.push("negative-edge");
    else if (
      Math.abs(t) < HINT_RULES.noEdgeT &&
      (r.vsRandomPct === null || r.vsRandomPct <= 0)
    )
      hints.push("no-edge");
  }
  if (
    enough &&
    mfe.winnersAvgR !== null &&
    mfe.winnersAvgR > 0 &&
    mfe.winnersRealizedAvgR !== null &&
    mfe.winnersRealizedAvgR / mfe.winnersAvgR < HINT_RULES.cutWinnersKeepShare
  )
    hints.push("exit-cuts-winners");
  if (
    mfe.losersWithStop >= HINT_RULES.minClosed &&
    mfe.losersReached1R / mfe.losersWithStop >= HINT_RULES.giveBackShare
  )
    hints.push("exit-gives-back");
  if (
    enough &&
    r.stopsInFirstBarShare !== null &&
    r.stopsInFirstBarShare >= HINT_RULES.stopInNoiseShare
  )
    hints.push("stop-in-noise");
  if (enough && r.pnlBeforeFees > 0 && stats.realizedPnl <= 0)
    hints.push("costs");
  const sides = r.byDirection.filter((d) => d.closed >= HINT_RULES.minClosed);
  if (sides.length === 2 && sides[0].pnl > 0 && sides[1].pnl < 0)
    hints.push("direction");
  // Контроль hold (S20/F20) не закрывает сделок по определению — редкость сигнала к нему не относится.
  if (
    r.archetype !== "control" &&
    stats.closed < SAMPLE_THRESHOLDS.preliminary &&
    (r.daysTo.preliminary === null ||
      r.daysTo.preliminary > HINT_RULES.rareSignalDays)
  )
    hints.push("rare-signal");
  const c = r.concentration;
  if (
    enough &&
    stats.realizedPnl > 0 &&
    ((c.topShare ?? 0) >= HINT_RULES.concentrationShare ||
      (c.topTradeShare ?? 0) >= HINT_RULES.concentrationShare)
  )
    hints.push("concentration");
  if (r.flags.length) hints.push("engine");
  return hints;
}

function daysTo(target: number, closed: number, perDay: number): number | null {
  if (closed >= target) return 0;
  return perDay > 0 ? (target - closed) / perDay : null;
}

const familyKey = (e: LabExperiment) =>
  `${e.config.timeframe}|${JSON.stringify(e.config.entry)}`;

/**
 * Семейства: одинаковые вход и таймфрейм (по конфигу, не по подписям); контроль не группируется.
 * В `variant` — только строки конфига, которые различаются между членами.
 */
export function buildFamilies(
  experiments: LabExperiment[],
  reports: ExperimentReport[],
): Family[] {
  const reportOf = new Map(reports.map((r) => [r.id, r]));
  const byKey = new Map<string, LabExperiment[]>();
  for (const e of experiments) {
    if (archetypeOf(e.config.entry) === "control") continue;
    const key = familyKey(e);
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }
  const families: Family[] = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const configs = members.map((m) => ({
      e: m,
      r: reportOf.get(m.id),
      lines: describeConfig(m.config),
    }));
    const labels = [
      ...new Set(configs.flatMap((c) => c.lines.map((l) => l.label))),
    ].filter((l) => l !== "Таймфрейм" && l !== "Вход");
    const lineValue = (lines: ConfigLine[], label: string) =>
      lines.find((l) => l.label === label)?.value ?? "—";
    const differing = labels.filter(
      (label) =>
        new Set(configs.map((c) => lineValue(c.lines, label))).size > 1,
    );
    const [first] = members;
    families.push({
      key,
      label: `${describeEntry(first.config.entry)}, ${first.config.timeframe}`,
      members: configs.map(({ e, r, lines }) => ({
        id: e.id,
        market: e.market,
        name: e.name,
        variant: differing
          .map((label) => `${label}: ${lineValue(lines, label)}`)
          .join("; "),
        closed: r?.stats.closed ?? 0,
        pnl: r?.stats.realizedPnl ?? 0,
        avgR: r?.r.mean ?? null,
        tR: r?.r.t ?? null,
        avgReturnPct: r?.returnPct.mean ?? null,
      })),
    });
  }
  return families.sort((a, b) => b.members.length - a.members.length);
}

export function buildArchetypes(
  experiments: ExperimentReport[],
  trades: PaperTrade[],
): ArchetypeRow[] {
  const archetypeOfId = new Map(experiments.map((e) => [e.id, e.archetype]));
  const closed = trades
    .filter(isClosed)
    .filter((t) => archetypeOfId.has(t.experimentId));
  const rows: ArchetypeRow[] = [];
  // Группы активов — каждая отдельно (Spot, USDⓈ-M, COIN-M): архетип в разных группах не смешиваем.
  for (const market of MARKETS) {
    for (const archetype of Object.keys(ARCHETYPE_LABEL) as Archetype[]) {
      const members = experiments.filter(
        (e) => e.market === market && e.archetype === archetype,
      );
      if (!members.length) continue;
      const own = closed.filter(
        (t) =>
          t.market === market &&
          archetypeOfId.get(t.experimentId) === archetype,
      );
      rows.push({
        market,
        archetype,
        experiments: members.length,
        closed: own.length,
        pnl: own.reduce((s, t) => s + t.pnl, 0),
        avgReturnPct: avg(own.map(returnPct)),
        avgR: avg(
          own.map((t) => t.rMultiple).filter((r): r is number => r !== null),
        ),
      });
    }
  }
  return rows;
}

interface ReportContext {
  now: number;
  /** Начало периода отчёта, мс. */
  start: number;
  /** Средняя доходность сделки контроля «случайный вход» рынка; null — контроля или сделок нет. */
  randomAvgReturn: Record<ExperimentMarket, number | null>;
  controls: Controls;
}

function experimentReport(
  e: LabExperiment,
  own: PaperTrade[],
  ctx: ReportContext,
): ExperimentReport {
  const closed = own.filter(isClosed);
  const stats = computeStats(own, e.initialBudget);
  const resetAt = e.resetAt ? Date.parse(e.resetAt) : null;
  const accountedFrom =
    resetAt !== null && resetAt > ctx.start ? resetAt : ctx.start;
  const periodDays = Math.max((ctx.now - accountedFrom) / DAY, 1 / 24);
  const ret = meanStat(closed.map(returnPct));
  const avgWin = avg(closed.filter((t) => t.pnl > 0).map((t) => t.pnl));
  const avgLoss = avg(closed.filter((t) => t.pnl < 0).map((t) => -t.pnl));
  const perDay = stats.closed / periodDays;
  const isRandomControl = ctx.controls[e.market].random === e.id;
  const randomAvg = isRandomControl ? null : ctx.randomAvgReturn[e.market];
  const bySymbol = sliceRows(closed, (t) => t.symbol);
  const tfMs = TIMEFRAME_MS[e.config.timeframe];
  const holdMinutes = avg(closed.map((t) => holdMs(t) / MINUTE));
  const stops = closed.filter((t) => t.exitReason === "sl");
  const partial: HintInput = {
    archetype: archetypeOf(e.config.entry),
    stats,
    pnlBeforeFees: stats.realizedPnl + stats.fees,
    returnPct: ret,
    vsRandomPct:
      ret.mean !== null && randomAvg !== null ? ret.mean - randomAvg : null,
    mfe: mfeStats(closed),
    stopsInFirstBarShare: stops.length
      ? stops.filter((t) => holdMs(t) < tfMs).length / stops.length
      : null,
    byDirection: sliceRows(closed, (t) => t.direction),
    daysTo: {
      preliminary: daysTo(SAMPLE_THRESHOLDS.preliminary, stats.closed, perDay),
      decidable: daysTo(SAMPLE_THRESHOLDS.decidable, stats.closed, perDay),
    },
    concentration: concentration(closed),
    flags: suspiciousFlags(e, stats, closed),
  };
  return {
    id: e.id,
    market: e.market,
    name: e.name,
    hypothesis: e.hypothesis,
    enabled: e.enabled,
    demoMirror: e.demoMirror,
    config: describeConfig(e.config),
    accountedFrom: new Date(accountedFrom).toISOString(),
    periodDays,
    resetAt: e.resetAt,
    ...partial,
    sample: sampleLevel(stats.closed),
    r: meanStat(
      closed.map((t) => t.rMultiple).filter((r): r is number => r !== null),
    ),
    payoff:
      avgWin !== null && avgLoss !== null && avgLoss > 0
        ? avgWin / avgLoss
        : null,
    tradesPerDay: perDay,
    avgHoldMinutes: holdMinutes,
    avgHoldBars: holdMinutes === null ? null : (holdMinutes * MINUTE) / tfMs,
    byExitReason: sliceRows(closed, (t) => t.exitReason ?? "—"),
    byHourUtc: sliceRows(closed, (t) => hourBucket(t.openedAt)).sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    byDay: sliceRows(closed, (t) => dayOf(t.closedAt)).sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    byWeekpart: sliceRows(closed, (t) => weekpart(t.openedAt)),
    bestSymbols: bySymbol.filter((r) => r.pnl > 0).slice(0, 5),
    worstSymbols: bySymbol
      .filter((r) => r.pnl < 0)
      .slice(-5)
      .reverse(),
    hints: hintsOf(partial),
  };
}

/** Отчёт по всем экспериментам эпохи (или периода), отсортированный по средней доходности сделки. */
export function buildLabReport(
  data: LabDataset,
  opts: LabReportOptions,
): LabReport {
  const known = new Set(data.experiments.map((e) => e.id));
  const focus = opts.focus ?? [];
  const unknown = focus.filter((id) => !known.has(id));
  if (unknown.length)
    throw new Error(
      `--experiment: нет экспериментов ${unknown.join(", ")}; есть: ${[...known].join(", ")}`,
    );

  const runStart = Date.parse(data.run.startedAt);
  const start = Math.max(runStart, opts.since ?? runStart);
  const trades = filterTrades(data.trades, { since: opts.since ?? null });
  const byExperiment = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    const list = byExperiment.get(t.experimentId) ?? [];
    list.push(t);
    byExperiment.set(t.experimentId, list);
  }
  const controls = controlsOf(data.experiments);
  const avgReturnOf = (id: string | null): number | null =>
    id === null
      ? null
      : avg((byExperiment.get(id) ?? []).filter(isClosed).map(returnPct));
  const ctx: ReportContext = {
    now: opts.now,
    start,
    controls,
    randomAvgReturn: {
      spot: avgReturnOf(controls.spot.random),
      usdm: avgReturnOf(controls.usdm.random),
      coinm: avgReturnOf(controls.coinm.random),
    },
  };

  const experiments = data.experiments
    .map((e) => experimentReport(e, byExperiment.get(e.id) ?? [], ctx))
    .sort(
      (a, b) =>
        (b.returnPct.mean ?? Number.NEGATIVE_INFINITY) -
        (a.returnPct.mean ?? Number.NEGATIVE_INFINITY),
    );

  return {
    generatedAt: new Date(opts.now).toISOString(),
    database: opts.database ?? null,
    run: data.run,
    periodStart: new Date(start).toISOString(),
    periodDays: Math.max((opts.now - start) / DAY, 1 / 24),
    focus,
    controls,
    market: opts.market ?? null,
    archetypes: buildArchetypes(experiments, trades),
    families: buildFamilies(data.experiments, experiments),
    experiments,
    legend: LEGEND,
  };
}

// --- CSV сделок для ad-hoc анализа агентом ---

const CSV_COLUMNS = [
  "id",
  "experimentId",
  "market",
  "symbol",
  "direction",
  "openedAt",
  "closedAt",
  "entryPrice",
  "exitPrice",
  "quantity",
  "initialStop",
  "takeProfit",
  "atr",
  "extreme",
  "exitReason",
  "fees",
  "pnl",
  "rMultiple",
  "mfeR",
  "returnPct",
  "holdMinutes",
] as const;

/** Сделки периода (и открытые) — для своих расчётов поверх отчёта. */
export function renderTradesCsv(trades: PaperTrade[]): string {
  const cell = (v: unknown): string =>
    v === null || v === undefined
      ? ""
      : typeof v === "number"
        ? String(Number.isInteger(v) ? v : Number(v.toPrecision(10)))
        : String(v);
  const rows = trades.map((t) => {
    const closed = isClosed(t);
    const values: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      ...t,
      mfeR: mfeR(t),
      returnPct: closed ? returnPct(t) : null,
      holdMinutes: closed ? holdMs(t) / MINUTE : null,
    };
    return CSV_COLUMNS.map((c) => cell(values[c])).join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
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
const signedPct = (v: number | null, digits = 3): string =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
const days = (v: number | null): string =>
  v === null ? "∞" : v === 0 ? "есть" : `${Math.ceil(v)} дн.`;
const dateTime = (iso: string) => iso.slice(0, 16).replace("T", " ");

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

function dayLine(e: ExperimentReport): string {
  if (!e.byDay.length) return "";
  const byPnl = [...e.byDay].sort((a, b) => b.pnl - a.pnl);
  const best = byPnl[0];
  const worst = byPnl[byPnl.length - 1];
  const weekend = e.byWeekpart.find((w) => w.key === "выходные");
  const parts = [
    `По дням: лучший ${best.key} (${usd(best.pnl)} $), худший ${worst.key} (${usd(worst.pnl)} $)`,
    weekend
      ? `выходные — ${weekend.closed} сделок, ${usd(weekend.pnl)} $`
      : "выходных сделок нет",
    e.concentration.topTradeShare === null
      ? "доля крупнейшей сделки — при PnL ≤ 0 не считается"
      : `крупнейшая сделка — ${pct(e.concentration.topTradeShare)} PnL`,
  ];
  return `${parts.join("; ")}.`;
}

function experimentSection(e: ExperimentReport): string[] {
  const s = e.stats;
  const head = `### ${e.id} · ${e.name}${e.enabled ? "" : " (выключен)"}${e.demoMirror ? " · демо-зеркало" : ""}`;
  // Сброс показываем, только если учёт действительно начинается с него (а не с --since позже сброса).
  const accounted =
    e.resetAt !== null && e.accountedFrom === e.resetAt
      ? `Учёт с ${dateTime(e.accountedFrom)} UTC (сброс эксперимента), ${num(e.periodDays, 1)} дн.`
      : "";
  if (s.closed === 0)
    return [
      head,
      "",
      `Гипотеза: ${e.hypothesis}`,
      "",
      `Архетип: ${ARCHETYPE_LABEL[e.archetype]}. Закрытых сделок нет (открыто ${s.open}).${accounted ? ` ${accounted}` : ""}`,
      "",
    ];
  return [
    head,
    "",
    `Гипотеза: ${e.hypothesis}`,
    "",
    `- Архетип: ${ARCHETYPE_LABEL[e.archetype]}`,
    ...e.config.map((c) => `- ${c.label}: ${c.value}`),
    "",
    ...(accounted ? [accounted] : []),
    `Выборка: ${s.closed} закрытых (${SAMPLE_LABEL[e.sample]}), открыто ${s.open}; ${num(e.tradesPerDay, 1)} сделок/день; до 30 — ${days(e.daysTo.preliminary)}, до 100 — ${days(e.daysTo.decidable)}.`,
    `Результат: PnL ${usd(s.realizedPnl)} $ (до комиссий ${usd(e.pnlBeforeFees)} $), win rate ${pct(s.winRate)}, PF ${num(s.profitFactor)}, payoff ${num(e.payoff)}, просадка ${pct(s.maxDrawdownPct, 1)}.`,
    `Ожидание: R ${num(e.r.mean)} (sd ${num(e.r.sd)}, t ${num(e.r.t)}, n ${e.r.n}); доходность ${signedPct(e.returnPct.mean)}% (t ${num(e.returnPct.t)}); к случайному входу рынка ${e.vsRandomPct === null ? "—" : `${signedPct(e.vsRandomPct)} п. п.`}`,
    `Удержание: ${e.avgHoldMinutes === null ? "—" : `${Math.round(e.avgHoldMinutes)} мин (${num(e.avgHoldBars, 1)} свечей ТФ)`}; стопов раньше одной свечи — ${pct(e.stopsInFirstBarShare)}. MFE: прибыльные ${num(e.mfe.winnersAvgR)}R при реализованных ${num(e.mfe.winnersRealizedAvgR)}R, убыточные ${num(e.mfe.losersAvgR)}R; убыточных с MFE ≥ 1R — ${e.mfe.losersReached1R} из ${e.mfe.losersWithStop}.`,
    e.concentration.topSymbol
      ? `Концентрация: ${e.concentration.topSymbol} — ${usd(e.concentration.topPnl ?? 0)} $ (${e.concentration.topShare === null ? "при общем PnL ≤ 0" : `${pct(e.concentration.topShare)} PnL`}); без неё доходность ${signedPct(e.concentration.avgReturnPctWithoutTop)}%.`
      : "Концентрация: прибыльных монет нет.",
    dayLine(e),
    ...(e.hints.length ? [`Подсказки: ${e.hints.join(", ")}.`] : []),
    ...(e.flags.length ? ["", `⚠️ Подозрительно: ${e.flags.join("; ")}.`] : []),
    "",
    ...sliceTable("Направление", e.byDirection),
    ...sliceTable("Причина выхода", e.byExitReason),
    ...sliceTable("Час открытия, UTC", e.byHourUtc),
    ...sliceTable("Лучшие монеты", e.bestSymbols),
    ...sliceTable("Худшие монеты", e.worstSymbols),
  ];
}

function marketSection(m: MarketContext | null): string[] {
  if (!m)
    return ["Контекст рынка не загружен (`--no-market` или нет сети).", ""];
  const daily = m.daily
    .map((d) => `${d.date.slice(5)} ${signedPct(d.returnPct, 1)}%`)
    .join(" · ");
  return [
    `**Рынок.** ${describeMarket(m)}`,
    ...(daily ? [`BTC по дням: ${daily}.`] : []),
    "",
  ];
}

function archetypesSection(rows: ArchetypeRow[]): string[] {
  if (!rows.length) return [];
  return [
    "## Архетипы",
    "",
    "Тренд и возврат к среднему обычно антикоррелированы по режимам: минус у обеих групп — смотри комиссии и частоту сделок.",
    "",
    "| Рынок | Архетип | Эксп. | Закрыто | PnL $ | Доходн. % | avg R |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.market} | ${ARCHETYPE_LABEL[r.archetype]} | ${r.experiments} | ${r.closed} | ${usd(r.pnl)} | ${signedPct(r.avgReturnPct)} | ${num(r.avgR)} |`,
    ),
    "",
  ];
}

function familiesSection(families: Family[]): string[] {
  if (!families.length) return [];
  return [
    "## Семейства: один вход, разные выходы и юниверс",
    "",
    "Плато — соседи по параметрам дают похожий результат; пик — хорош только один вариант (скорее шум).",
    "",
    ...families.flatMap((f) => [
      `**${f.label}**`,
      "",
      "| id | Рынок | Отличия | Закрыто | PnL $ | avg R | t(R) | Доходн. % |",
      "|---|---|---|---|---|---|---|---|",
      ...f.members.map(
        (m) =>
          `| ${m.id} | ${m.market} | ${m.variant || "—"} | ${m.closed} | ${usd(m.pnl)} | ${num(m.avgR)} | ${num(m.tR)} | ${signedPct(m.avgReturnPct)} |`,
      ),
      "",
    ]),
  ];
}

const controlLine = (c: Controls): string => {
  const one = (market: ExperimentMarket) =>
    `${market} — ${c[market].random ?? "нет"} (случайный вход), ${c[market].hold ?? "нет"} (hold BTC)`;
  return `Контроль: ${MARKETS.map(one).join("; ")}.`;
};

export function renderLabReport(report: LabReport): string {
  const focus = new Set(report.focus);
  const detailed = focus.size
    ? report.experiments.filter((e) => focus.has(e.id))
    : report.experiments;
  const rows = report.experiments.map(
    (e) =>
      `| ${focus.has(e.id) ? `**${e.id}**` : e.id} | ${e.name} | ${e.market} | ${ARCHETYPE_LABEL[e.archetype]} | ${e.stats.closed} | ${SAMPLE_LABEL[e.sample]} | ${usd(e.stats.realizedPnl)} | ${pct(e.stats.winRate)} | ${num(e.stats.profitFactor)} | ${num(e.r.mean)} | ${num(e.r.t)} | ${signedPct(e.returnPct.mean)} | ${[...(e.flags.length ? ["⚠️"] : []), ...e.hints].join(" ")} |`,
  );
  return [
    "# Отчёт лаборатории",
    "",
    `Сформирован ${report.generatedAt}. БД: ${report.database ?? "не указана"}. Эпоха #${report.run.id} с ${report.run.startedAt}; период с ${report.periodStart} (${num(report.periodDays, 1)} дн.).`,
    "Только закрытые сделки текущего учёта; PnL — за вычетом комиссий и слиппеджа. Как читать — скилл trading-lab; подсказки — references/failure-modes.md.",
    controlLine(report.controls),
    ...(focus.size
      ? [
          `Фокус: ${report.focus.join(", ")} — подробные разделы только по ним; сводка, архетипы, семейства и контроль — по всем.`,
        ]
      : []),
    "",
    ...marketSection(report.market),
    "## Сводка (по средней доходности сделки)",
    "",
    "| id | Эксперимент | Рынок | Архетип | Закрыто | Выборка | PnL $ | Win | PF | avg R | t(R) | Доходн. % | Подсказки |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...archetypesSection(report.archetypes),
    ...familiesSection(report.families),
    "## Эксперименты",
    "",
    ...detailed.flatMap(experimentSection),
  ].join("\n");
}
