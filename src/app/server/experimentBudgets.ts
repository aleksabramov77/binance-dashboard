// Бюджеты лаборатории для хедера (spec 003 · 3a): данные эпохи из БД + последние цены Binance для
// нереализованного PnL открытых позиций. Только сервер.
import {
  computeMarketBudgets,
  type ExperimentBudgets,
  loadBudgetInputs,
  type PriceLookup,
} from "@/entities/experiment";
import { getDb } from "@/shared/db/client.server";
import { CooldownError } from "@/shared/lib/fetchRetry";
import { log } from "@/shared/lib/logger.server";
import { ensureEngineReady } from "./experimentEngine";
import { cachedTickerPrices } from "./tickerPrices";

export async function getExperimentBudgets(): Promise<ExperimentBudgets> {
  await ensureEngineReady();
  const { runId, inputs } = await loadBudgetInputs(getDb());
  const markets = [...new Set(inputs.open.map((t) => t.market))];

  // Цены — по группе: рынок не ответил (например, dapi для COIN-M) — его группа без нереализованного PnL
  // (подсказка в хедере это объясняет), остальные считаются как обычно.
  const loaded = new Map(
    await Promise.all(
      markets.map(async (m) => {
        try {
          return [m, await cachedTickerPrices(m)] as const;
        } catch (error) {
          // Во время паузы после 429/418 шапка опрашивается каждые 30 с — это debug, сама пауза уже
          // записана как binance.cooldown.
          log[error instanceof CooldownError ? "debug" : "warn"](
            "experiments.budgets",
            `Цены ${m} для нереализованного PnL недоступны`,
            { error: error instanceof Error ? error.message : String(error) },
          );
          return [m, null] as const;
        }
      }),
    ),
  );
  const prices: PriceLookup = (market, symbol) =>
    loaded.get(market)?.get(symbol);

  return { runId, markets: computeMarketBudgets(inputs, prices) };
}
