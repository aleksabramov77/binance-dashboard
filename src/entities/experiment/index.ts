// Хуки страниц лаборатории (клиент).

// Хранилище движка на Drizzle и сид каталога (только сервер: вызывает композиция src/app/server).

export { loadBudgetInputs } from "./api/budgetsStore";
export {
  createDbExperimentStore,
  type DbExperimentStore,
  ensureRun,
  seedExperiments,
} from "./api/dbStore";
// Чтение для страниц лаборатории (только сервер: вызывает композиция src/app/server).
export {
  readExperimentDetail,
  readExperimentsOverview,
} from "./api/readModel";
// Клиентские хуки и UI лаборатории (хедер, spec 003 · 3a).
export {
  engineStatusQueryKey,
  readEngineStatus,
  useEngineStatus,
} from "./api/useEngineStatus";
export {
  experimentBudgetsQueryKey,
  useExperimentBudgets,
} from "./api/useExperimentBudgets";
export {
  EXPERIMENT_TRADES_LIMIT,
  experimentQueryKey,
  experimentsQueryKey,
  useExperiment,
  useExperiments,
} from "./api/useExperiments";
export {
  type BudgetInputs,
  computeMarketBudgets,
  type PriceLookup,
} from "./lib/budgets";
// Агрегаты по сделкам и конфиг человеческим текстом — для страниц и разрезов /stats.
export {
  type ConfigLine,
  describeConfig,
  describeEntry,
  describeStop,
  describeTakeProfit,
  describeUniverse,
} from "./lib/describeConfig";
export {
  formatProfitFactor,
  formatR,
  formatRate,
  formatSignedUsd,
  pnlTone,
} from "./lib/formatStats";
export {
  computeStats,
  type EquityPoint,
  equityCurve,
  groupStats,
  maxDrawdown,
  type StatsGroup,
  type StatsTrade,
  type TradeStats,
} from "./lib/stats";
export {
  type ExperimentBudgets,
  experimentBudgetsSchema,
  type MarketBudget,
  marketBudgetSchema,
} from "./model/budget";
// Таблицы домена (Drizzle). Чистые описания без подключения — запросы делает сервер через shared/db.
export {
  type ExperimentRow,
  engineStateTable,
  experimentsTable,
  type NewExperimentRow,
  type NewPaperTradeRow,
  type PaperTradeRow,
  paperTradesTable,
  type RunRow,
  runsTable,
} from "./model/db";
// Контракт API движка: статус и тумблер.
export {
  type EngineStatus,
  type EngineTick,
  engineRunnerSchema,
  engineStatusSchema,
  engineTickSchema,
  engineToggleSchema,
} from "./model/engine";
export * from "./model/schema";
// Контракт API страниц /experiments и /experiments/[id].
export {
  type EquityPointView,
  type ExperimentDetailResponse,
  type ExperimentSummary,
  type ExperimentsResponse,
  equityPointSchema,
  experimentDetailResponseSchema,
  experimentSummarySchema,
  experimentsResponseSchema,
  type TradeStatsView,
  tradeStatsSchema,
} from "./model/view";
export { EquityChart } from "./ui/EquityChart";
export { MarketBudgets } from "./ui/MarketBudgets";
