// Серверная подсистема движка (хранилище, блокировка тика, таблицы, схемы) — отдельный вход для Deno.

export { loadBudgetInputs } from "./api/budgetsStore";
// Demo-зеркало (spec 008): какие сделки повторить на Binance Demo и какие закрыть (только сервер).
export {
  activeMirrorSymbols,
  claimMirror,
  claimMirrorsToClose,
  claimOpenMirrors,
  emptyMirrorSummary,
  listMirrorCandidates,
  type MirrorCandidate,
  type MirrorSummary,
  type MirrorToClose,
  markDemoReset,
  setExperimentDemoMirror,
  toDemoSummary,
  updateMirror,
} from "./api/mirrorDb";
// Чтение для страниц лаборатории (только сервер: вызывает композиция src/app/server).
export {
  type LabExperiment,
  readExperimentDetail,
  readExperimentFlags,
  readExperimentsOverview,
  readLabDataset,
  readTradeStats,
} from "./api/readModel";
// /settings лаборатории (задача 3d): атомарный сброс эпохи, тумблеры, контракт и хуки.
export {
  getEpoch,
  type ResetRunInput,
  type ResetRunOutcome,
  resetExperimentRun,
  resetRun,
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
// Группы активов (AG) — коды и названия для таблиц, фильтров и хедера (spec 0016).
export {
  ASSET_GROUP_DESCRIPTION,
  ASSET_GROUPS,
  type AssetGroup,
  assetGroupOf,
  type Market,
} from "./model/assetGroup";
export {
  type ExperimentBudgets,
  experimentBudgetsSchema,
  type MarketBudget,
  marketBudgetSchema,
} from "./model/budget";
export {
  ACTIVE_MIRROR_STATUSES,
  type ExperimentDemoMirror,
  experimentDemoMirrorSchema,
  MIRROR_STATUS_LABELS,
  MIRROR_STATUSES,
  type MirrorStatus,
  type MirrorView,
  mirrorStatusSchema,
  OPEN_MIRROR_STATUSES,
} from "./model/mirror";
export {
  type BudgetForm,
  budgetFormSchema,
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
  type TradeStatsView,
  tradeStatsSchema,
} from "./model/view";
export { DemoMisses } from "./ui/DemoMisses";
export { EquityChart } from "./ui/EquityChart";
export { MarketBudgets } from "./ui/MarketBudgets";
