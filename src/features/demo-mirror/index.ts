// Demo-зеркало (spec 008): лучшие paper-эксперименты повторяют входы на Binance Demo.
// Серверный слайс без доступа к бирже и БД — их передаёт композиция src/app/server/demoMirror.ts.
export { MIRROR } from "./config/mirror";
export {
  type MirrorDecision,
  type MirrorOrderRequest,
  type MirrorTradeInput,
  mirrorLevels,
  planMirror,
} from "./lib/planMirror";
export {
  type MirrorDeps,
  type MirrorRunResult,
  type MirrorStep,
  runMirror,
} from "./model/runMirror";
