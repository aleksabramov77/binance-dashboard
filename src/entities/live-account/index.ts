// Реальный счёт (spec 0047, домен «Лаборатория экспериментов»): пульс воркера реального счёта — контракт,
// последний пульс в БД, состояние для карточки, шапки и уведомлений. Ключа Binance здесь нет — он только у воркера.

// Только сервер: чтение и запись последнего пульса (вызывает композиция src/app/server/liveAccount.ts).
export { loadLiveState, saveLiveState } from "./api/liveStateDb";
export { liveAccountQueryKey, useLiveAccount } from "./api/useLiveAccount";
export {
  deriveLiveStatus,
  isSilent,
  type LiveEvent,
  type LiveStatus,
  planHeartbeat,
  planSilence,
  verdictText,
} from "./lib/status";
// Таблица (Drizzle) — запросы делает сервер через shared/db.
export { liveWorkerStateTable } from "./model/db";
export {
  LIVE_FIXTURES,
  LIVE_VERDICTS,
  type LiveFixture,
  type LiveHeartbeat,
  type LiveHeartbeatReply,
  type LiveState,
  type LiveStatusResponse,
  type LiveVerdict,
  liveHeartbeatReplySchema,
  liveHeartbeatSchema,
  liveMainAccountSchema,
  liveStateSchema,
  liveStatusResponseSchema,
} from "./model/heartbeat";
