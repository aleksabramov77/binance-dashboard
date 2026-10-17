// Платформа: монитор журнала (spec 008-logs) — правила «что-то сломалось», без спама, текст и срочность уведомления,
// задачи по тревогам в GitHub (spec 0037). Сбор данных, ИИ, уведомление (log.notify) и настройки GitHub внедряет
// композиция src/app/server/logMonitor.ts.
export { MONITOR } from "./config/rules";
export {
  detectIssues,
  type Issue,
  type MonitorSnapshot,
} from "./lib/detectIssues";
export { formatAlert } from "./lib/formatAlert";
export type { SampleLog, TrackedIssue } from "./lib/formatAlertIssue";
export { type GithubWarning, githubWarnings } from "./lib/githubWarnings";
export { type AlertRow, planAlerts } from "./lib/planAlerts";
export {
  type MonitorAlert,
  type MonitorDeps,
  type MonitorResult,
  runMonitor,
} from "./model/runMonitor";
export {
  type AlertIssuesConfig,
  type TrackIssuesInput,
  type TrackIssuesResult,
  trackAlertIssues,
} from "./model/trackAlertIssues";
