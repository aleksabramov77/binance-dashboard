// Demo-зеркало (spec 008): лучшие paper-эксперименты повторяют входы на Binance Demo.
// Серверный слайс без доступа к бирже и БД — их передаёт композиция src/app/server/demoMirror.ts.
export { MIRROR } from "./config/mirror";
// Записи журнала об отказах и пропусках (spec 0016) — пишет композиция.
export {
  type MirrorLogSubject,
  mirrorLogEntry,
} from "./lib/mirrorLog";
export {
  type ActiveMirror,
  type MirrorDecision,
  type MirrorListing,
  type MirrorOrderRequest,
  type MirrorTradeInput,
  mirrorLevels,
  planMirror,
} from "./lib/planMirror";
export {
  emptyMirrorRunResult,
  type MirrorCloseItem,
  type MirrorDeps,
  type MirrorOpenResult,
  type MirrorRunResult,
  type MirrorStep,
  runMirror,
} from "./model/runMirror";
