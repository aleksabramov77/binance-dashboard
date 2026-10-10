// Хранилище движка на Drizzle и сид каталога (только сервер: вызывает композиция src/app/server).
export {
  createDbExperimentStore,
  type DbExperimentStore,
  ensureRun,
  seedExperiments,
} from "./api/dbStore.ts";
// Межпроцессная блокировка тика (advisory lock в общей БД, spec 007b).
export {
  ENGINE_TICK_LOCK_KEY,
  type ExperimentDb,
  type LockedResult,
  withEngineTickLock,
} from "./api/tickLock.ts";
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
} from "./model/db.ts";
// Контракт API движка: статус и тумблер.
export {
  type EngineStatus,
  type EngineTick,
  engineRunnerSchema,
  engineStatusSchema,
  engineTickSchema,
  engineToggleSchema,
} from "./model/engine.ts";
export * from "./model/schema.ts";
