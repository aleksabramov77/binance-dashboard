// Движок лаборатории экспериментов (spec 003, задача 1d). Серверный слайс: не импортировать из
// клиентских компонентов. Модули среды-независимы (Node и Deno): только trading-core и zod.
export {
  EXPERIMENT_CATALOG,
  FUTURES_EXPERIMENTS,
  INITIAL_BUDGET,
  SPOT_EXPERIMENTS,
} from "./config/catalog";
export { ENGINE } from "./config/engine";
export type { CandleCache } from "./lib/candles";
export {
  isEligibleSymbol,
  type MarketTicker,
  pickUniverse,
} from "./lib/universe";
export { createMemoryStore, type MemoryStore } from "./model/memoryStore";
export {
  planReset,
  priceKey,
  type ResetClose,
  type ResetPlan,
} from "./model/planReset";
export {
  type Interval,
  readEnabled,
  readRunner,
  runTick,
  type TickDeps,
  type TickResult,
  type TickStatus,
} from "./model/runTick";
export {
  DEFAULT_RUNNER,
  ENGINE_KEYS,
  type EngineRunner,
  type ExperimentStore,
  RUNNERS,
  type TradeClose,
  type TradeProgress,
} from "./model/store";
