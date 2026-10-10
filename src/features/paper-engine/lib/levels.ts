import type {
  EntrySignal,
  ExitRule,
  TradeDirection,
} from "@binance-dashboard/trading-core";

export interface Levels {
  stop: number | null;
  takeProfit: number | null;
}

/**
 * Стоп и тейк сделки от цены входа по правилам выхода эксперимента.
 * pct — в процентах (1 = 1%). null — уровни не построить (нет ATR, уровень сигнала по ту
 * сторону цены или нет стопа для R:R) — в такую сделку не входим.
 */
export function computeLevels(
  exit: ExitRule,
  signal: EntrySignal,
  direction: TradeDirection,
  entry: number,
  atr: number,
): Levels | null {
  const sign = direction === "long" ? 1 : -1;
  const below = (level: number) => sign * (entry - level) > 0;

  let stop: number | null;
  switch (exit.stop.type) {
    case "atr":
      if (!(atr > 0)) return null;
      stop = entry - sign * exit.stop.mult * atr;
      break;
    case "pct":
      stop = entry * (1 - (sign * exit.stop.pct) / 100);
      break;
    case "signal":
      if (signal.stop === undefined) return null;
      stop = signal.stop;
      break;
    case "none":
      stop = null;
      break;
  }
  if (stop !== null && !below(stop)) return null;

  const tp = exit.takeProfit;
  let takeProfit: number | null = null;
  if (tp?.type === "rr") {
    if (stop === null) return null;
    takeProfit = entry + tp.r * (entry - stop);
  } else if (tp?.type === "pct") {
    takeProfit = entry * (1 + (sign * tp.pct) / 100);
  } else if (tp?.type === "signal") {
    if (signal.target === undefined) return null;
    takeProfit = signal.target;
  }
  // Цель уже позади цены входа (вход со слиппеджем перескочил её) — сделка без смысла.
  if (takeProfit !== null && below(takeProfit)) return null;
  if (takeProfit !== null && takeProfit === entry) return null;
  return { stop, takeProfit };
}
