import {
  type ExperimentMarket,
  MARKETS,
  type TradeDirection,
  unrealizedPnl,
} from "@binance-dashboard/trading-core";
import type { MarketBudget } from "../model/budget";

export interface BudgetInputs {
  /** Стартовые бюджеты экспериментов (все, включая выключенные: их капитал тоже в эпохе). */
  experiments: { market: ExperimentMarket; initialBudget: number }[];
  /** Закрытые сделки эпохи, агрегированные по рынку: pnl уже после комиссий. */
  closed: { market: ExperimentMarket; pnl: number; fees: number }[];
  open: {
    market: ExperimentMarket;
    symbol: string;
    direction: TradeDirection;
    entryPrice: number;
    quantity: number;
  }[];
}

/** Последняя цена символа на рынке; undefined — нет цены. null вместо функции — цены не загружены. */
export type PriceLookup = (
  market: ExperimentMarket,
  symbol: string,
) => number | undefined;

/**
 * Бюджеты по рынкам: equity = старт + реализованный PnL (после комиссий) + нереализованный PnL
 * открытых позиций по последней цене (с комиссией входа и будущего выхода). Если цены нет хотя бы
 * у одной открытой позиции рынка — нереализованный не учитывается вовсе (null), чтобы не показывать
 * частичную сумму как полную.
 */
export function computeMarketBudgets(
  inputs: BudgetInputs,
  prices: PriceLookup | null,
): MarketBudget[] {
  return MARKETS.map((market) => {
    const initial = inputs.experiments
      .filter((e) => e.market === market)
      .reduce((s, e) => s + e.initialBudget, 0);
    const closed = inputs.closed.filter((c) => c.market === market);
    const realized = closed.reduce((s, c) => s + c.pnl, 0);
    const fees = closed.reduce((s, c) => s + c.fees, 0);
    const open = inputs.open.filter((t) => t.market === market);

    let unrealized: number | null = open.length === 0 ? 0 : null;
    if (open.length > 0 && prices) {
      let total = 0;
      for (const t of open) {
        const mark = prices(market, t.symbol);
        if (mark === undefined) {
          total = Number.NaN;
          break;
        }
        total += unrealizedPnl(t, mark);
      }
      unrealized = Number.isNaN(total) ? null : total;
    }

    const equity = initial + realized + (unrealized ?? 0);
    const change = equity - initial;
    return {
      market,
      initial,
      realized,
      fees,
      unrealized,
      openTrades: open.length,
      equity,
      change,
      changePct: initial > 0 ? change / initial : 0,
    };
  });
}
