import type { Issue } from "./detectIssues";
import type { TrackedIssue } from "./formatAlertIssue";
import type { AlertRow } from "./planAlerts";

const ICON = { critical: "🔴", warning: "🟡" } as const;

/** Строка про задачу в GitHub под тревогой (spec 0037). */
const TRACKED: Record<TrackedIssue["action"], (url: string) => string> = {
  created: (url) => `🤖 Claude разбирает: ${url}`,
  queued: (url) => `📝 Задача: ${url} (лимит автозапусков на сутки)`,
  commented: (url) => `📎 Задача: ${url}`,
};

/** Текст уведомления (Telegram, без разметки — не нужно экранировать). */
export function formatAlert(input: {
  notify: Issue[];
  resolved: AlertRow[];
  analysis: string | null;
  /** null — адрес сайта не задан: без строки журнала. */
  logsUrl: string | null;
  /** Задачи в GitHub по тревогам; нет — уведомление без ссылок. */
  tracked?: TrackedIssue[];
}): string | null {
  const { notify, resolved, analysis, logsUrl, tracked = [] } = input;
  if (notify.length === 0 && resolved.length === 0) return null;
  const lines: string[] = [];
  if (notify.length) {
    lines.push(
      `⚠️ Binance Dashboard: ${notify.length === 1 ? "проблема" : `проблем — ${notify.length}`}`,
    );
    for (const i of notify) {
      lines.push(`${ICON[i.severity]} ${i.title}: ${i.details}`);
      const task = tracked.find((t) => t.key === i.key);
      if (task) lines.push(TRACKED[task.action](task.url));
    }
    if (analysis) lines.push("", `🤖 ${analysis}`);
  }
  if (resolved.length) {
    if (lines.length) lines.push("");
    for (const r of resolved) lines.push(`✅ Восстановлено: ${r.title}`);
  }
  if (logsUrl) lines.push("", `Журнал: ${logsUrl}`);
  return lines.join("\n");
}
