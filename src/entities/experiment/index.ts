// Хранилище движка на Drizzle и сид каталога (только сервер: вызывает композиция src/app/server).
export {
  createDbExperimentStore,
  type DbExperimentStore,
  ensureRun,
  seedExperiments,
} from "./api/dbStore";
// /settings лаборатории (задача 3d): атомарный сброс эпохи, тумблеры, контракт и хуки.
export {
  getEpoch,
  type ResetRunInput,
  type ResetRunOutcome,
  resetRun,
  setExperimentEnabled,
} from "./api/settingsDb";
export {
  labSettingsQueryKey,
  useLabSettings,
  useResetCapitals,
  useSetExperimentEnabled,
  useSetNextBudget,
} from "./api/useLabSettings";
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
export {
  type BudgetForm,
  budgetFormSchema,
  DEFAULT_INITIAL_BUDGET,
  type Epoch,
  type ExperimentEnabled,
  epochSchema,
  experimentEnabledSchema,
  type LabSettings,
  labSettingsSchema,
  MAX_INITIAL_BUDGET,
  MIN_INITIAL_BUDGET,
  RESET_CONFIRM_WORD,
  type ResetRequest,
  type ResetResult,
  resetRequestSchema,
  resetResultSchema,
} from "./model/settings";
