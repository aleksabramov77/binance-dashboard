import { MONITOR, type MonitorRules } from "../config/rules";
import {
  detectIssues,
  type Issue,
  type MonitorSnapshot,
} from "../lib/detectIssues";
import { formatAlert } from "../lib/formatAlert";
import { type AlertRow, planAlerts } from "../lib/planAlerts";

/** Запись журнала для разбора ИИ (уже без секретов). */
export interface SampleLog {
  ts: string;
  level: string;
  event: string;
  message: string;
  error?: string;
}

export interface MonitorDeps {
  collect: (now: number) => Promise<MonitorSnapshot>;
  samples: (issues: Issue[], since: number) => Promise<SampleLog[]>;
  loadAlerts: () => Promise<AlertRow[]>;
  saveAlerts: (rows: AlertRow[]) => Promise<void>;
  /** Разбор ИИ; null или ошибка — уведомление уходит без него. */
  analyze?: (issues: Issue[], samples: SampleLog[]) => Promise<string | null>;
  /** Отправка уведомления; не задана — только состояние в БД. */
  notify?: (text: string) => Promise<void>;
  prune: () => Promise<number>;
  logsUrl: string;
}

export interface MonitorResult {
  issues: Issue[];
  notified: number;
  resolved: number;
  sent: boolean;
  pruned: number;
  analysisError?: string;
}

/** Один прогон монитора: собрать срез → найти проблемы → решить, о чём писать → отправить. */
export async function runMonitor(
  deps: MonitorDeps,
  now = Date.now(),
  rules: MonitorRules = MONITOR,
): Promise<MonitorResult> {
  const snapshot = await deps.collect(now);
  const issues = detectIssues(snapshot, rules);
  const plan = planAlerts(issues, await deps.loadAlerts(), now, rules.repeatMs);

  let analysis: string | null = null;
  let analysisError: string | undefined;
  if (plan.notify.length && deps.analyze) {
    try {
      const samples = await deps.samples(plan.notify, now - rules.windowMs);
      analysis = await deps.analyze(plan.notify, samples);
    } catch (error) {
      analysisError = error instanceof Error ? error.message : String(error);
    }
  }

  const text = formatAlert({
    notify: plan.notify,
    resolved: plan.resolved,
    analysis,
    logsUrl: deps.logsUrl,
  });
  let sent = false;
  if (text && deps.notify) {
    await deps.notify(text);
    sent = true;
  }
  // Состояние — после отправки: не дошло уведомление — повторим в следующий прогон.
  await deps.saveAlerts(
    sent || !text
      ? plan.rows
      : plan.rows.map((r) => ({ ...r, lastSent: null })),
  );
  return {
    issues,
    notified: plan.notify.length,
    resolved: plan.resolved.length,
    sent,
    pruned: await deps.prune(),
    analysisError,
  };
}
