import type {
  Experiment,
  PaperTrade,
  SkippedSignal,
} from "@binance-dashboard/trading-core";
import type {
  ExperimentStore,
  SkippedSignalCount,
  TradeClose,
  TradeProgress,
} from "./store.ts";

export interface MemoryStore extends ExperimentStore {
  /** Все сделки (открытые и закрытые) — для тестов и отладки. */
  trades(): PaperTrade[];
  /** Все отсечённые сигналы — для тестов. */
  skipped(): SkippedSignal[];
  /** Начать новую эпоху (сброс тестовых капиталов). */
  newRun(): number;
}

/** Хранилище в памяти: тесты и прогоны без БД. */
export function createMemoryStore(
  experiments: Experiment[],
  initialState: Record<string, unknown> = {},
): MemoryStore {
  const trades = new Map<string, PaperTrade>();
  const skipped = new Map<string, SkippedSignal>();
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
    skippedSignalCounts: async (run, experimentIds) => {
      const ids = new Set(experimentIds);
      const counts = new Map<string, SkippedSignalCount>();
      for (const s of skipped.values()) {
        if (s.runId !== run || !ids.has(s.experimentId)) continue;
        const key = `${s.experimentId}:${s.reason}`;
        const row = counts.get(key) ?? {
          experimentId: s.experimentId,
          reason: s.reason,
          count: 0,
        };
        row.count++;
        counts.set(key, row);
      }
      return [...counts.values()];
    },
    insertSkippedSignals: async (rows) => {
      for (const r of rows)
        if (!skipped.has(r.id)) skipped.set(r.id, structuredClone(r));
    },
    pruneSkippedSignals: async (before) => {
      const limit = Date.parse(before);
      for (const [id, s] of skipped)
        if (Date.parse(s.at) < limit) skipped.delete(id);
    },
    getState: async (key) => structuredClone(state.get(key)),
    setState: async (key, value) => {
      state.set(key, structuredClone(value));
    },
    trades: () => [...trades.values()].map((t) => structuredClone(t)),
    skipped: () => [...skipped.values()].map((s) => structuredClone(s)),
    newRun: () => ++runId,
  };
}
