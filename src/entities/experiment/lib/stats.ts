import type { PaperTrade } from "@binance-dashboard/trading-core";

// Чистые агрегаты по paper-сделкам (spec 003): таблица /experiments, детальная страница и разрезы
// /stats (задача 3c). pnl сделки уже за вычетом комиссий (trading-core/fills), поэтому
// equity = старт + Σ pnl закрытых сделок; открытые сделки в PnL не входят.

/** Поля сделки, нужные агрегатам: подходит и PaperTrade, и строка из БД после разбора. */
export type StatsTrade = Pick<
  PaperTrade,
  "openedAt" | "closedAt" | "pnl" | "fees" | "rMultiple"
>;

export interface TradeStats {
  trades: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  /** Доля прибыльных среди закрытых; null — закрытых нет. */
  winRate: number | null;
  /** Реализованный PnL за вычетом комиссий, USD. */
  realizedPnl: number;
  /** Комиссии закрытых сделок, USD. */
  fees: number;
  grossProfit: number;
  grossLoss: number;
  /** Σ прибыли / Σ |убытков|; null — убыточных сделок нет (бесконечность или нечего делить). */
  profitFactor: number | null;
  /** Средний R закрытых сделок со стопом; null — таких нет. */
  avgR: number | null;
  /** Наибольшая просадка equity от пика, USD (≥ 0). */
  maxDrawdown: number;
  /** Та же просадка в долях от пика (0,05 = 5 %). */
  maxDrawdownPct: number;
  initialBudget: number;
  equity: number;
}

export interface EquityPoint {
  /** ISO-время: старт эпохи или закрытие сделки. */
  at: string;
  equity: number;
}

type ClosedTrade<T extends StatsTrade> = T & { closedAt: string; pnl: number };

const isClosed = <T extends StatsTrade>(t: T): t is ClosedTrade<T> =>
  t.closedAt !== null && t.pnl !== null;

/** Закрытые сделки в порядке закрытия (стабильно при равном времени). */
function closedByTime<T extends StatsTrade>(trades: T[]): ClosedTrade<T>[] {
  return trades
    .filter(isClosed)
    .sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
}

/** Equity-кривая: стартовая точка и по точке на каждую закрытую сделку. */
export function equityCurve(
  trades: StatsTrade[],
  initialBudget: number,
  startedAt: string,
): EquityPoint[] {
  let equity = initialBudget;
  const points: EquityPoint[] = [{ at: startedAt, equity }];
  for (const t of closedByTime(trades)) {
    equity += t.pnl;
    points.push({ at: t.closedAt, equity });
  }
  return points;
}

/** Просадка по последовательности значений equity: в USD и в долях от пика. */
export function maxDrawdown(equities: number[]): { usd: number; pct: number } {
  let peak = Number.NEGATIVE_INFINITY;
  let usd = 0;
  let pct = 0;
  for (const e of equities) {
    peak = Math.max(peak, e);
    const dd = peak - e;
    if (dd > usd) usd = dd;
    if (peak > 0 && dd / peak > pct) pct = dd / peak;
  }
  return { usd, pct };
}

export function computeStats(
  trades: StatsTrade[],
  initialBudget: number,
): TradeStats {
  const closed = closedByTime(trades);
  let grossProfit = 0;
  let grossLoss = 0;
  let fees = 0;
  let wins = 0;
  let losses = 0;
  let rSum = 0;
  let rCount = 0;
  let equity = initialBudget;
  const equities = [equity];
  for (const t of closed) {
    if (t.pnl > 0) {
      wins++;
      grossProfit += t.pnl;
    } else if (t.pnl < 0) {
      losses++;
      grossLoss -= t.pnl;
    }
    fees += t.fees;
    if (t.rMultiple !== null) {
      rSum += t.rMultiple;
      rCount++;
    }
    equity += t.pnl;
    equities.push(equity);
  }
  const dd = maxDrawdown(equities);
  return {
    trades: trades.length,
    closed: closed.length,
    open: trades.length - closed.length,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : null,
    realizedPnl: equity - initialBudget,
    fees,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    avgR: rCount ? rSum / rCount : null,
    maxDrawdown: dd.usd,
    maxDrawdownPct: dd.pct,
    initialBudget,
    equity,
  };
}

export interface StatsGroup<K extends string> {
  key: K;
  stats: TradeStats;
}

/**
 * Разрез по произвольному ключу (эксперимент, рынок, символ, направление). Стартовый капитал
 * группы задаёт budgetOf (например, сумма бюджетов экспериментов рынка); по умолчанию 0 —
 * тогда equity группы равна её PnL. Группы — по убыванию реализованного PnL.
 */
export function groupStats<T extends StatsTrade, K extends string>(
  trades: T[],
  keyOf: (t: T) => K,
  budgetOf: (key: K) => number = () => 0,
): StatsGroup<K>[] {
  const groups = new Map<K, T[]>();
  for (const t of trades) {
    const key = keyOf(t);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups]
    .map(([key, list]) => ({ key, stats: computeStats(list, budgetOf(key)) }))
    .sort((a, b) => b.stats.realizedPnl - a.stats.realizedPnl);
}
