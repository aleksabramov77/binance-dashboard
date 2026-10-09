import type { ExecutedOrder, TradeStatus } from "@/entities/trade";

const OPEN: ReadonlySet<TradeStatus> = new Set([
  "open",
  "open-trailing",
  "open-unprotected",
]);

export interface TradeSummary {
  /** Выходы закрытых сделок (TP, SL, вручную…). */
  closed: number;
  wins: number;
  losses: number;
  realizedPnl: number;
  /** Открытые позиции (символ + рынок). */
  open: number;
  unrealizedPnl: number;
}

/** Сводка по загруженной истории: результат закрытых сделок и текущий PnL открытых. */
export function summarizeTrades(orders: ExecutedOrder[]): TradeSummary {
  const summary: TradeSummary = {
    closed: 0,
    wins: 0,
    losses: 0,
    realizedPnl: 0,
    open: 0,
    unrealizedPnl: 0,
  };
  const openPositions = new Set<string>();
  for (const o of orders) {
    if (o.trade.role === "exit" && o.realizedPnl !== null) {
      summary.closed += 1;
      summary.realizedPnl += o.realizedPnl;
      if (o.realizedPnl > 0) summary.wins += 1;
      else summary.losses += 1;
    }
    const key = `${o.market}:${o.symbol}`;
    if (OPEN.has(o.trade.status) && !openPositions.has(key)) {
      // uPnL — у позиции целиком, он одинаковый во всех её строках: считаем один раз.
      openPositions.add(key);
      summary.unrealizedPnl += o.trade.unrealizedPnl ?? 0;
    }
  }
  summary.open = openPositions.size;
  return summary;
}
