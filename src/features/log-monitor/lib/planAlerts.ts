import type { Issue } from "./detectIssues";

export interface AlertRow {
  key: string;
  status: "active" | "resolved";
  title: string;
  firstSeen: string;
  lastSeen: string;
  lastSent: string | null;
}

export interface AlertPlan {
  /** Новые проблемы и те, о которых пора напомнить. */
  notify: Issue[];
  /** Были активны, теперь пропали — «восстановлено». */
  resolved: AlertRow[];
  /** Что записать в alert_state. */
  rows: AlertRow[];
}

/**
 * Без спама: о новой проблеме — сразу, о незакрытой — не чаще repeatMs, о пропавшей — один раз
 * «восстановлено». Чистая функция.
 */
export function planAlerts(
  issues: Issue[],
  previous: AlertRow[],
  now: number,
  repeatMs: number,
): AlertPlan {
  const at = new Date(now).toISOString();
  const byKey = new Map(previous.map((r) => [r.key, r]));
  const current = new Set(issues.map((i) => i.key));
  const notify: Issue[] = [];
  const rows: AlertRow[] = [];

  for (const issue of issues) {
    const prev = byKey.get(issue.key);
    const fresh = !prev || prev.status === "resolved";
    const due =
      fresh ||
      prev.lastSent === null ||
      now - Date.parse(prev.lastSent) >= repeatMs;
    if (due) notify.push(issue);
    rows.push({
      key: issue.key,
      status: "active",
      title: issue.title,
      firstSeen: fresh ? at : prev.firstSeen,
      lastSeen: at,
      lastSent: due ? at : (prev?.lastSent ?? null),
    });
  }

  const resolved = previous.filter(
    (r) => r.status === "active" && !current.has(r.key),
  );
  for (const r of resolved)
    rows.push({ ...r, status: "resolved", lastSeen: at });
  return { notify, resolved, rows };
}
