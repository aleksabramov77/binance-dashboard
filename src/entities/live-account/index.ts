// Реальный счёт (spec 0047, домен «Лаборатория экспериментов»): пульс воркера реального счёта — контракт,
// последний пульс в БД, состояние для карточки, шапки и уведомлений. Ключа Binance здесь нет — он только у воркера.

// Только сервер: аварийный стоп реального счёта (spec 0049).
export {
  completeLiveCloseAll,
  loadLiveHalt,
  requestLiveCloseAll,
  setLiveStopped,
} from "./api/liveHaltDb";
// Только сервер: чтение и запись последнего пульса (вызывает композиция src/app/server/liveAccount.ts).
export { loadLiveState, saveLiveState } from "./api/liveStateDb";
export { liveAccountQueryKey, useLiveAccount } from "./api/useLiveAccount";
// Реальное зеркало (spec 0049): лимиты, проверки входа, PnL по исполнениям, тексты журнала и Telegram. Чистые
// функции без сети и БД: прогон собирает воркер (scripts/lib/liveMirrorRun.ts), хранилище — src/app/server/liveMirror.ts.
export { LIVE, LIVE_SKIP } from "./config/liveMirror";
export { type FillLike, type FillsPnl, fillsPnl } from "./lib/fillsPnl";
export { nextUtcMidnight, utcDayStart } from "./lib/liveDay";
export {
  createLiveGate,
  type LiveEntrySize,
  type LiveGateDeps,
  type LiveOpenDecision,
  type LiveSkipDecision,
} from "./lib/liveGate";
export {
  type LiveHaltAction,
  type LiveTradeSubject,
  liveCloseAllDoneText,
  liveCloseFailedText,
  liveDailyLimitText,
  liveEntryText,
  liveExitText,
  liveHaltText,
  liveToggleText,
  liveUnprotectedText,
} from "./lib/liveMessages";
export { liveUsd } from "./lib/money";
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
  type LiveHalt,
  type LiveHaltActionRequest,
  liveHaltActionSchema,
  liveHaltSchema,
} from "./model/halt";
export {
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
