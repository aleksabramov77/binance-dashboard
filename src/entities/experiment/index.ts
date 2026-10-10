// Хранилище движка на Drizzle и сид каталога (только сервер: вызывает композиция src/app/server).
export {
  createDbExperimentStore,
  type DbExperimentStore,
  ensureRun,
  seedExperiments,
} from "./api/dbStore";
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
