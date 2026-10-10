import { marketSchema } from "@binance-dashboard/trading-core";
import { z } from "zod";
// Контракт /api/experiments/budgets: бюджеты лаборатории по рынкам в текущей эпохе (хедер, spec 003 · 3a).

export const marketBudgetSchema = z.object({
  market: marketSchema,
  /** Сумма стартовых бюджетов экспериментов рынка, USD. */
  initial: z.number(),
  /** Реализованный PnL закрытых сделок эпохи — уже за вычетом комиссий, USD. */
  realized: z.number(),
  /** Комиссии закрытых сделок эпохи (для подсказки; в realized уже учтены), USD. */
  fees: z.number(),
  /** PnL открытых позиций по последней цене; null — цены недоступны. */
  unrealized: z.number().nullable(),
  openTrades: z.number().int(),
  /** Старт + реализованный + нереализованный (если известен). */
  equity: z.number(),
  /** equity − initial, USD. */
  change: z.number(),
  /** Изменение долей от старта (0.012 = +1,2%); 0 при нулевом старте. */
  changePct: z.number(),
});

export const experimentBudgetsSchema = z.object({
  runId: z.number().int(),
  markets: z.array(marketBudgetSchema),
});

export type MarketBudget = z.infer<typeof marketBudgetSchema>;
export type ExperimentBudgets = z.infer<typeof experimentBudgetsSchema>;
