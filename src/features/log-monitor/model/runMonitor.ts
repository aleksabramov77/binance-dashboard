import { MONITOR, type MonitorRules } from "../config/rules";
import {
  detectIssues,
  type Issue,
  type MonitorSnapshot,
} from "../lib/detectIssues";
import { formatAlert } from "../lib/formatAlert";
import type { SampleLog, TrackedIssue } from "../lib/formatAlertIssue";
import { type AlertRow, planAlerts } from "../lib/planAlerts";
import type { TrackIssuesInput, TrackIssuesResult } from "./trackAlertIssues";

export interface MonitorDeps {
  collect: (now: number) => Promise<MonitorSnapshot>;
  samples: (issues: Issue[], since: number) => Promise<SampleLog[]>;
  loadAlerts: () => Promise<AlertRow[]>;
  saveAlerts: (rows: AlertRow[]) => Promise<void>;
  /** Разбор ИИ; null или ошибка — уведомление уходит без него. */
  analyze?: (issues: Issue[], samples: SampleLog[]) => Promise<string | null>;
  /**
   * Задачи в GitHub по тревогам (spec 0037); не задана — как раньше. Вызывается до отправки, ссылки идут
   * в текст; ошибка не мешает уведомлению.
   */
  trackIssues?: (input: TrackIssuesInput) => Promise<TrackIssuesResult>;
  /** Отправка уведомления; не задана — только состояние в БД. */
  notify?: (text: string) => Promise<void>;
  prune: () => Promise<number>;
  logsUrl: string | null;
}

export interface MonitorResult {
  issues: Issue[];
  notified: number;
  resolved: number;
  sent: boolean;
  pruned: number;
  analysisError?: string;
  /** Задачи в GitHub, заведённые или дополненные в этом прогоне. */
  tracked: TrackedIssue[];
  /** Сбои GitHub — в журнал как warn monitor.github. */
  githubErrors: string[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  let samples: SampleLog[] = [];
  if (plan.notify.length && (deps.analyze || deps.trackIssues)) {
    try {
      samples = await deps.samples(plan.notify, now - rules.windowMs);
      if (deps.analyze) analysis = await deps.analyze(plan.notify, samples);
    } catch (error) {
      analysisError = message(error);
    }
  }

  let tracked: TrackedIssue[] = [];
  let githubErrors: string[] = [];
  if (plan.notify.length && deps.trackIssues) {
    try {
      ({ tracked, errors: githubErrors } = await deps.trackIssues({
        notify: plan.notify,
        fresh: plan.fresh,
        analysis,
        samples,
        logsUrl: deps.logsUrl,
        now,
      }));
    } catch (error) {
      githubErrors = [message(error)];
    }
  }

  const text = formatAlert({
    notify: plan.notify,
    resolved: plan.resolved,
    analysis,
    logsUrl: deps.logsUrl,
    tracked,
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
    tracked,
    githubErrors,
  };
}
