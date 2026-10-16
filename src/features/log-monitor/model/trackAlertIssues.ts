import {
  commentIssue,
  countIssuesCreatedSince,
  createIssue,
  ensureLabels,
  type GithubRepoConfig,
  listOpenIssues,
} from "@/shared/api/github";
import { ALERT_ISSUES } from "../config/rules";
import type { Issue } from "../lib/detectIssues";
import {
  alertMarker,
  formatAlertIssue,
  formatAlertRepeat,
  type SampleLog,
  type TrackedIssue,
} from "../lib/formatAlertIssue";

export interface TrackIssuesInput {
  /** Тревоги этого прогона (новые и напоминания). */
  notify: Issue[];
  /** Ключи новых тревог — только по ним заводим задачу. */
  fresh: string[];
  analysis: string | null;
  samples: SampleLog[];
  logsUrl: string;
  now: number;
}

export interface TrackIssuesResult {
  tracked: TrackedIssue[];
  /** Сбои GitHub по отдельным тревогам — остальные обработаны. */
  errors: string[];
}

export interface AlertIssuesConfig extends GithubRepoConfig {
  autofixPerDay: number;
}

const LABELS = Object.values(ALERT_ISSUES.labels);

/**
 * Открытые задачи тревог: с меткой alert или alert-queued (labels у GitHub — «И», поэтому два запроса).
 * Routine метку alert не снимает, очередь запускают сменой alert-queued на alert — задача найдётся.
 */
async function openAlertIssues(cfg: GithubRepoConfig) {
  const [autofix, queued] = await Promise.all([
    listOpenIssues(cfg, { label: ALERT_ISSUES.labels.autofix.name }),
    listOpenIssues(cfg, { label: ALERT_ISSUES.labels.queued.name }),
  ]);
  const seen = new Set(autofix.map((i) => i.number));
  return [...autofix, ...queued.filter((i) => !seen.has(i.number))];
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Задачи в GitHub по тревогам (spec 0037): открытая задача с маркером тревоги — комментарий «повтор»;
 * новая тревога без задачи — задача с меткой alert (запускает Claude) или alert-queued сверх лимита
 * за сутки; напоминание без открытой задачи (её закрыли) — ничего.
 */
export async function trackAlertIssues(
  cfg: AlertIssuesConfig,
  input: TrackIssuesInput,
): Promise<TrackIssuesResult> {
  const tracked: TrackedIssue[] = [];
  const errors: string[] = [];
  if (!input.notify.length) return { tracked, errors };

  const open = await openAlertIssues(cfg);
  let createdToday: number | null = null;
  let labelsReady = false;

  for (const issue of input.notify) {
    try {
      const marker = alertMarker(issue.key);
      // Маркер — всегда первая строка тела: в журнале ниже он может встретиться как текст.
      const existing = open.find(
        (i) => i.body.split(/\r?\n/, 1)[0].trim() === marker,
      );
      if (existing) {
        await commentIssue(
          cfg,
          existing.number,
          formatAlertRepeat(issue, input.now),
        );
        tracked.push({
          key: issue.key,
          action: "commented",
          url: existing.url,
        });
        continue;
      }
      if (!input.fresh.includes(issue.key)) continue;

      createdToday ??= await countIssuesCreatedSince(
        cfg,
        ALERT_ISSUES.labels.autofix.name,
        new Date(input.now - ALERT_ISSUES.autofixWindowMs),
      );
      if (!labelsReady) {
        await ensureLabels(cfg, LABELS);
        labelsReady = true;
      }
      const queued = createdToday >= cfg.autofixPerDay;
      const label = queued
        ? ALERT_ISSUES.labels.queued
        : ALERT_ISSUES.labels.autofix;
      const created = await createIssue(cfg, {
        ...formatAlertIssue(
          issue,
          input.analysis,
          input.samples,
          input.logsUrl,
        ),
        labels: [label.name],
      });
      if (!queued) createdToday += 1;
      tracked.push({
        key: issue.key,
        action: queued ? "queued" : "created",
        url: created.url,
      });
    } catch (error) {
      errors.push(`${issue.key}: ${message(error)}`);
    }
  }
  return { tracked, errors };
}
