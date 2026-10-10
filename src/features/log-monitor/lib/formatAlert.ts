import type { Issue } from "./detectIssues";
import type { AlertRow } from "./planAlerts";

const ICON = { critical: "🔴", warning: "🟡" } as const;

/** Текст уведомления (Telegram, без разметки — не нужно экранировать). */
export function formatAlert(input: {
  notify: Issue[];
  resolved: AlertRow[];
  analysis: string | null;
  logsUrl: string;
}): string | null {
  const { notify, resolved, analysis, logsUrl } = input;
  if (notify.length === 0 && resolved.length === 0) return null;
  const lines: string[] = [];
  if (notify.length) {
    lines.push(
      `⚠️ Binance Dashboard: ${notify.length === 1 ? "проблема" : `проблем — ${notify.length}`}`,
    );
    for (const i of notify)
      lines.push(`${ICON[i.severity]} ${i.title}: ${i.details}`);
    if (analysis) lines.push("", `🤖 ${analysis}`);
  }
  if (resolved.length) {
    if (lines.length) lines.push("");
    for (const r of resolved) lines.push(`✅ Восстановлено: ${r.title}`);
  }
  lines.push("", `Журнал: ${logsUrl}`);
  return lines.join("\n");
}
