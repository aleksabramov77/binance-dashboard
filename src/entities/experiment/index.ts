// Серверная подсистема движка (хранилище, блокировка тика, таблицы, схемы) — отдельный вход для Deno.

export { loadBudgetInputs } from "./api/budgetsStore";
// Demo-зеркало (spec 008): какие сделки повторить на Binance Demo и какие закрыть (только сервер).
export {
  type ActiveMirrorRow,
  activeMirrors,
  claimMirror,
  claimMirrorToClose,
  claimOpenMirrors,
  type DemoResetScope,
  emptyMirrorSummary,
  listMirrorCandidates,
  listMirrorsToClose,
  listOpenMirrorLegs,
  type MirrorCandidate,
  type MirrorScope,
  type MirrorSummary,
  type MirrorToClose,
  markDemoReset,
  markMirrorClosedByExchange,
  markMirrorUnprotected,
  setExperimentDemoMirror,
  toDemoSummary,
  updateMirror,
} from "./api/mirrorDb";
// Блокировка прогона demo-зеркала (spec 0012, PR 2e): два прогона крона не идут одновременно.
export { MIRROR_RUN_LOCK_KEY, withMirrorRunLock } from "./api/mirrorLock";
// Чтение для страниц лаборатории (только сервер: вызывает композиция src/app/server).
export {
  type LabExperiment,
  type LabRun,
  type LabSkippedCount,
  readExperimentDetail,
  readExperimentFlags,
  readExperimentsOverview,
  readLabDataset,
  readTradeStats,
} from "./api/readModel";
// /settings лаборатории (задача 3d): атомарный сброс эпохи, тумблеры, контракт и хуки.
export {
  type ExperimentEnabledState,
  getEpoch,
  type ResetRunInput,
  type ResetRunOutcome,
  resetExperimentRun,
  resetGroupRun,
  resetRun,
  setDisableReason,
  setExperimentEnabled,
} from "./api/settingsDb";
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
  experimentsListQueryKey,
  experimentsQueryKey,
  useExperiment,
  useExperiments,
} from "./api/useExperiments";
export {
  labSettingsQueryKey,
  useLabSettings,
  useResetCapitals,
  useResetDemo,
  useResetExperimentPaper,
  useResetGroup,
  useSetExperimentDemoMirror,
  useSetExperimentEnabled,
  useSetNextBudget,
} from "./api/useLabSettings";
export { tradeStatsQueryKey, useTradeStats } from "./api/useTradeStats";
export * from "./engine.ts";
export {
  type BudgetInputs,
  computeMarketBudgets,
  type PriceLookup,
} from "./lib/budgets";
// Сравнение настроек контрольного и варианта (spec 0046).
export {
  CONFIG_SAME_TEXT,
  type ConfigDiffLine,
  diffExperimentConfig,
} from "./lib/configDiff";
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
// Период страниц лаборатории: «Все эпохи», прошлые эпохи (spec 0046).
export {
  ALL_RUNS_LABEL,
  describeRunView,
  runEnd,
  toRunParam,
} from "./lib/runView";
export {
  blacklistCandidates,
  filterTrades,
  periodStart,
  rankGroups,
  type SliceExperiment,
  type SliceFilters,
  type SliceTrade,
  sliceStats,
} from "./lib/slices";
export {
  computeDemoStats,
  computeStats,
  type DemoStats,
  type EquityPoint,
  equityCurve,
  groupStats,
  maxDrawdown,
  type StatsGroup,
  type StatsTrade,
  type TradeStats,
} from "./lib/stats";
// Варианты эксперимента рядом с контрольным (spec 0046).
export {
  controlOf,
  enabledVariantsOf,
  type VariantLink,
  variantLetter,
  variantLetters,
  variantsByControl,
} from "./lib/variants";
// Группы активов (AG) — коды и названия для таблиц, фильтров и хедера (spec 0016).
export {
  ASSET_GROUP_DESCRIPTION,
  ASSET_GROUPS,
  type AssetGroup,
  assetGroupOf,
  COINM_MIRROR_BLOCKED,
  DEMO_MIRROR_MARKETS,
  type DemoMirrorMarket,
  type Market,
  parseMarketParam,
} from "./model/assetGroup";
export {
  type ExperimentBudgets,
  experimentBudgetsSchema,
  type MarketBudget,
  marketBudgetSchema,
} from "./model/budget";
// Причина выключения эксперимента (spec 0046).
export {
  DISABLE_NOTE_MAX,
  DISABLE_REASON_KEYS,
  DISABLE_REASONS,
  type DisabledInfo,
  type DisableForm,
  type DisableReason,
  disabledInfoSchema,
  disableFormSchema,
  disableNoteSchema,
  disableReasonSchema,
  toDisabledInfo,
} from "./model/disable";
export {
  ACTIVE_MIRROR_STATUSES,
  type ExperimentDemoMirror,
  experimentDemoMirrorSchema,
  MIRROR_STATUS_LABELS,
  MIRROR_STATUSES,
  type MirrorProtectRefs,
  type MirrorStatus,
  type MirrorView,
  mirrorProtectRefsSchema,
  mirrorStatusSchema,
  OPEN_MIRROR_STATUSES,
} from "./model/mirror";
export type {
  InvalidExperimentRow,
  OnInvalidExperiment,
} from "./model/parseRows";
export {
  type BudgetForm,
  budgetFormSchema,
  type ControlConflict,
  controlConflictSchema,
  DEFAULT_INITIAL_BUDGET,
  type DemoResetRequest,
  type DemoResetResult,
  demoResetRequestSchema,
  demoResetResultSchema,
  type Epoch,
  type ExperimentEnabled,
  type ExperimentReset,
  type ExperimentResetResult,
  epochSchema,
  experimentEnabledSchema,
  experimentResetResultSchema,
  experimentResetSchema,
  type GroupResetRequest,
  type GroupResetResult,
  groupResetRequestSchema,
  groupResetResultSchema,
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
// Контракт API разрезов /stats (3c).
export {
  parseStatsQuery,
  STATS_GROUP_BY,
  STATS_PERIODS,
  type StatsGroupBy,
  type StatsGroupView,
  type StatsPeriod,
  type StatsQuery,
  type StatsQueryInput,
  statsGroupBySchema,
  statsGroupSchema,
  statsPeriodSchema,
  statsQuerySchema,
  type TradeStatsResponse,
  tradeStatsResponseSchema,
} from "./model/statsView";
// Контракт API страниц /experiments и /experiments/[id].
export {
  type DemoSummary,
  demoSummarySchema,
  type EquityPointView,
  type ExperimentDetailResponse,
  type ExperimentSummary,
  type ExperimentsResponse,
  equityPointSchema,
  experimentDetailResponseSchema,
  experimentSummarySchema,
  experimentsResponseSchema,
  type FamilyMember,
  familyMemberSchema,
  parseRunParam,
  type RunParam,
  type RunView,
  runParamSchema,
  runViewSchema,
  type TradeStatsView,
  tradeStatsSchema,
} from "./model/view";
export { DemoMisses } from "./ui/DemoMisses";
export { DisabledBadge } from "./ui/DisabledBadge";
export { EquityChart, type EquityMark } from "./ui/EquityChart";
export { MissingRunNotice, RunSelect } from "./ui/RunSelect";
