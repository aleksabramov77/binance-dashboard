// Платформа: монитор журнала (spec 008-logs) — правила «что-то сломалось», без спама, текст уведомления.
// Сбор данных, ИИ и Telegram внедряет композиция src/app/server/logMonitor.ts.
export { MONITOR } from "./config/rules";
export {
  detectIssues,
  type Issue,
  type MonitorSnapshot,
} from "./lib/detectIssues";
export { formatAlert } from "./lib/formatAlert";
export { type AlertRow, planAlerts } from "./lib/planAlerts";
export {
  type MonitorDeps,
  type MonitorResult,
  runMonitor,
  type SampleLog,
} from "./model/runMonitor";
