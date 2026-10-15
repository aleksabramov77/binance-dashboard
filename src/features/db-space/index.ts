// Платформа: свободное место в базе (spec 0021) — пороги, план уведомлений без повторов, тексты для бота.
// Замер, alert_state и Telegram внедряет композиция src/app/server/dbSpace.ts.
export { DB_SPACE, type DbSpaceRules } from "./config/thresholds";
export {
  type DbTableSize,
  type DbUsage,
  formatDbSpace,
  formatMb,
  formatSpaceAlert,
  freePctOf,
} from "./lib/formatDbSpace";
export {
  planSpaceAlerts,
  type SpaceAlertPlan,
  type SpaceAlertRow,
  spaceAlertTitle,
} from "./lib/planSpaceAlerts";
