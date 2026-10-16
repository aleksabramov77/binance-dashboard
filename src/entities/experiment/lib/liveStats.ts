import type { MirrorStatus } from "../model/mirror";
import type { LiveSummary } from "../model/view";
import { maxDrawdown } from "./stats";

// Real-колонки /experiments (spec 0054): метрики реальных сделок эксперимента за всё время — по образцу демо
// (computeDemoStats), но PnL — по исполнениям с комиссиями (spec 0049), а Max DD и Equity — в $: у реального счёта
// нет капитала на эксперимент (деньги общие, $10 на сделку), поэтому Equity = накопленный PnL от нуля.

/** Поля строки live_mirror_orders, нужные метрикам. */
export interface LiveStatsRow {
  status: MirrorStatus;
  /** Реализованный PnL по исполнениям, $, после комиссий; null — не посчитан. */
  realizedPnl: number | null;
  /** PnL — оценка по ценам входа и выхода, а не по исполнениям. */
  pnlEstimated: boolean;
  closedAt: Date | string | null;
}

export const emptyLiveSummary = (): LiveSummary => ({
  trades: 0,
  open: 0,
  closed: 0,
  wins: 0,
  losses: 0,
  rejected: 0,
  skipped: 0,
  winRate: null,
  pnl: 0,
  estimated: 0,
  unknown: 0,
  grossProfit: 0,
  profitFactor: null,
  maxDrawdown: 0,
});

const closedTime = (r: LiveStatsRow) =>
  r.closedAt === null ? 0 : new Date(r.closedAt).getTime();

/**
 * Метрики реальных сделок одного эксперимента. Отказ (биржа не приняла вход) и пропуск (лимиты, монета занята, мало
 * средств, стоп входов, вход не свежий) — только счётчики. Закрытая сделка без PnL (исполнения не прочитаны и оценки
 * нет) — в «закрытых», но не в PnL, win rate и просадке: она в unknown. Просадка — от пика накопленного PnL в порядке
 * закрытия, старт — 0.
 */
export function computeLiveStats(rows: readonly LiveStatsRow[]): LiveSummary {
  const s = emptyLiveSummary();
  let grossLoss = 0;
  let equity = 0;
  const equities = [equity];
  const sorted = [...rows].sort((a, b) => closedTime(a) - closedTime(b));
  for (const r of sorted) {
    if (r.status === "rejected") {
      s.rejected++;
      continue;
    }
    if (r.status === "skipped") {
      s.skipped++;
      continue;
    }
    s.trades++;
    if (r.status !== "closed") {
      s.open++;
      continue;
    }
    s.closed++;
    if (r.realizedPnl === null) {
      s.unknown++;
      continue;
    }
    const pnl = r.realizedPnl;
    if (r.pnlEstimated) s.estimated++;
    if (pnl > 0) {
      s.wins++;
      s.grossProfit += pnl;
    } else if (pnl < 0) {
      s.losses++;
      grossLoss -= pnl;
    }
    equity += pnl;
    equities.push(equity);
  }
  const known = s.closed - s.unknown;
  s.winRate = known ? s.wins / known : null;
  s.pnl = equity;
  s.profitFactor = grossLoss > 0 ? s.grossProfit / grossLoss : null;
  s.maxDrawdown = maxDrawdown(equities).usd;
  return s;
}
