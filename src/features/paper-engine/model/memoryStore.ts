import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import type { ExperimentStore, TradeClose, TradeProgress } from "./store.ts";

export interface MemoryStore extends ExperimentStore {
  /** Все сделки (открытые и закрытые) — для тестов и отладки. */
  trades(): PaperTrade[];
  /** Начать новую эпоху (сброс тестовых капиталов). */
  newRun(): number;
}

/** Хранилище в памяти: тесты и прогоны без БД. */
export function createMemoryStore(
  experiments: Experiment[],
  initialState: Record<string, unknown> = {},
): MemoryStore {
  const trades = new Map<string, PaperTrade>();
  const state = new Map(Object.entries(structuredClone(initialState)));
  let runId = 1;

  const get = (id: string) => {
    const trade = trades.get(id);
    if (!trade) throw new Error(`Сделка ${id} не найдена`);
    return trade;
  };

  return {
    listExperiments: async () => structuredClone(experiments),
    currentRunId: async () => runId,
    openTrades: async (run) =>
      [...trades.values()]
        .filter((t) => t.runId === run && t.closedAt === null)
        .map((t) => structuredClone(t)),
    realizedPnl: async (run) => {
      const out: Record<string, number> = {};
      for (const t of trades.values())
        if (t.runId === run && t.closedAt !== null)
          out[t.experimentId] = (out[t.experimentId] ?? 0) + (t.pnl ?? 0);
      return out;
    },
    insertTrade: async (trade) => {
      if (!trades.has(trade.id)) trades.set(trade.id, structuredClone(trade));
    },
    updateTrade: async (id, progress: TradeProgress) => {
      Object.assign(get(id), progress);
    },
    closeTrade: async (id, close: TradeClose) => {
      Object.assign(get(id), close);
    },
    getState: async (key) => structuredClone(state.get(key)),
    setState: async (key, value) => {
      state.set(key, structuredClone(value));
    },
    trades: () => [...trades.values()].map((t) => structuredClone(t)),
    newRun: () => ++runId,
  };
}
