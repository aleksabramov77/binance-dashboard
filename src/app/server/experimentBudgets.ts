// Бюджеты лаборатории для хедера (spec 003 · 3a): данные эпохи из БД + последние цены Binance для
// нереализованного PnL открытых позиций. Только сервер.
import {
  computeMarketBudgets,
  type ExperimentBudgets,
  type ExperimentMarket,
  loadBudgetInputs,
  type PriceLookup,
} from "@/entities/experiment";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import { getDb } from "@/shared/db/client.server";
import { CooldownError } from "@/shared/lib/fetchRetry";
import { log } from "@/shared/lib/logger.server";
import { ensureEngineReady } from "./experimentEngine";

/** Хедер опрашивает раз в 30 с с каждой вкладки — тикеры кэшируем на процесс, чтобы не тратить вес Binance. */
const PRICES_TTL_MS = 20_000;

type PriceCache = Map<
  ExperimentMarket,
  { at: number; prices: Map<string, number> }
>;
const key = Symbol.for("binance-dashboard.experimentBudgetPrices");
const g = globalThis as typeof globalThis & { [key]?: PriceCache };

async function lastPrices(
  market: ExperimentMarket,
): Promise<Map<string, number>> {
  g[key] ??= new Map();
  const cached = g[key].get(market);
  if (cached && Date.now() - cached.at < PRICES_TTL_MS) return cached.prices;
  const prices = await fetchTickerPrices(market);
  g[key].set(market, { at: Date.now(), prices });
  return prices;
}

export async function getExperimentBudgets(): Promise<ExperimentBudgets> {
  await ensureEngineReady();
  const { runId, inputs } = await loadBudgetInputs(getDb());
  const markets = [...new Set(inputs.open.map((t) => t.market))];

  let prices: PriceLookup | null = null;
  try {
    const loaded = new Map(
      await Promise.all(
        markets.map(async (m) => [m, await lastPrices(m)] as const),
      ),
    );
    prices = (market, symbol) => loaded.get(market)?.get(symbol);
  } catch (error) {
    // Нет цен — показываем equity без нереализованного PnL (подсказка в хедере это объясняет). Во время паузы
    // после 429/418 шапка опрашивается каждые 30 с — это debug, сама пауза уже записана как binance.cooldown.
    log[error instanceof CooldownError ? "debug" : "warn"](
      "experiments.budgets",
      "Цены для нереализованного PnL недоступны",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return { runId, markets: computeMarketBudgets(inputs, prices) };
}
