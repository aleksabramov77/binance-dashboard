// @binance-dashboard/trading-core — автономное торговое ядро: индикаторы, схема эксперимента,
// стратегии входа, выходы, размер позиции и исполнение paper-сделок. Только чистые функции
// и Zod-схемы: без UI, Next.js, React, сети, БД и env (правило — в README.md).
export {
  type ExitEvent,
  type ExitPolicy,
  type OpenPosition,
  type WalkResult,
  walkExits,
} from "./exits.ts";
export * from "./experiment.ts";
export {
  entryFill,
  exitFill,
  FEE_RATE,
  type SettleInput,
  type Settlement,
  SLIPPAGE,
  settle,
  unrealizedPnl,
} from "./fills.ts";
export * from "./indicators/index.ts";
export {
  type PositionSize,
  SIZING,
  type SizeInput,
  sizePosition,
} from "./sizing.ts";
export {
  type EntrySignal,
  evaluateStrategy,
  type StrategyContext,
  type StrategyResult,
} from "./strategies.ts";
export type { Candle } from "./types.ts";
