// Реальный счёт (spec 0047, домен «Лаборатория экспериментов»): пульс воркера реального счёта — контракт,
// последний пульс в БД, состояние для карточки, шапки и уведомлений. Ключа Binance здесь нет — он только у воркера.

// Только сервер: аварийный стоп реального счёта (spec 0049).
export {
  type LiveCloseAllResult,
  loadLiveHalt,
  requestLiveCloseAll,
  saveLiveCloseAllRun,
  setLiveStopped,
} from "./api/liveHaltDb";
// Только сервер: чтение и запись последнего пульса (вызывает композиция src/app/server/liveAccount.ts).
export { loadLiveState, saveLiveState } from "./api/liveStateDb";
export { liveAccountQueryKey, useLiveAccount } from "./api/useLiveAccount";
export { useLiveHalt } from "./api/useLiveHalt";
// Реальное зеркало (spec 0049): лимиты, проверки входа, PnL по исполнениям, тексты журнала и Telegram. Чистые
// функции без сети и БД: прогон собирает воркер (scripts/lib/liveMirrorRun.ts), хранилище — src/app/server/liveMirror.ts.
export { LIVE, LIVE_SKIP } from "./config/liveMirror";
export { type FillLike, type FillsPnl, fillsPnl } from "./lib/fillsPnl";
export {
  demoTradesText,
  LIVE_MODE_LABEL,
  type LiveAutoReason,
  type LiveBlock,
  type LiveModeKey,
  liveAdviceText,
  liveAutoDisableText,
  liveAutoEnableText,
  liveAutoReasonText,
  liveAvgR,
  liveModeText,
  lossStreakText,
  thresholdUsd,
} from "./lib/liveAutoMessages";
export { nextUtcMidnight, utcDayStart } from "./lib/liveDay";
export {
  createLiveGate,
  type LiveEntrySize,
  type LiveGateDeps,
  type LiveOpenDecision,
  type LiveSkipDecision,
} from "./lib/liveGate";
export {
  escapeHtml,
  type LiveBalance,
  type LiveCardEntry,
  type LiveCardExit,
  type LiveCardStatus,
  type LiveHaltAction,
  type LiveSizeRaised,
  type LiveTradeSubject,
  liveBalanceAsOf,
  liveBinanceUrl,
  liveCardProblem,
  liveCardText,
  liveCardUrgent,
  liveCloseAllDoneText,
  liveDailyLimitText,
  liveHaltText,
  liveHeldText,
  liveLeftoverText,
} from "./lib/liveMessages";
export { livePrice, liveUsd } from "./lib/money";
export {
  deriveLiveStatus,
  isHandshake,
  isSilent,
  type LiveEvent,
  planHeartbeat,
  planSilence,
  verdictText,
} from "./lib/status";
// Таблицы (Drizzle) — запросы делает сервер через shared/db.
export { liveTradingHaltTable, liveWorkerStateTable } from "./model/db";
export {
  LIVE_HALT_ACTIONS,
  type LiveExperimentDay,
  type LiveHalt,
  type LiveHaltActionRequest,
  type LivePosition,
  type LiveTrading,
  liveExperimentDaySchema,
  liveHaltActionSchema,
  liveHaltSchema,
  livePositionSchema,
  liveTradingSchema,
} from "./model/halt";
export {
  DEMO_VENUE_HEADER,
  LIVE_FIXTURES,
  LIVE_VERDICTS,
  type LiveFixture,
  type LiveHeartbeat,
  type LiveHeartbeatReply,
  type LiveState,
  type LiveStatus,
  type LiveStatusResponse,
  type LiveVerdict,
  liveHeartbeatReplySchema,
  liveHeartbeatSchema,
  liveMainAccountSchema,
  liveStateSchema,
  liveStatusResponseSchema,
  liveStatusSchema,
} from "./model/heartbeat";
