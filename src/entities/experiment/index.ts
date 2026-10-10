// Хранилище движка на Drizzle и сид каталога (только сервер: вызывает композиция src/app/server).

export { loadBudgetInputs } from "./api/budgetsStore";
export {
  createDbExperimentStore,
  type DbExperimentStore,
  ensureRun,
  seedExperiments,
} from "./api/dbStore";
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
  type BudgetInputs,
  computeMarketBudgets,
  type PriceLookup,
} from "./lib/budgets";
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
export { MarketBudgets } from "./ui/MarketBudgets";
