import type { Issue } from "./detectIssues";

/** Запись журнала для разбора ИИ и задачи в GitHub (уже без секретов). */
export interface SampleLog {
  ts: string;
  level: string;
  event: string;
  message: string;
  error?: string;
}

/** Что сделано с задачей по тревоге (spec 0037). */
export interface TrackedIssue {
  key: string;
  /** created — новая задача, Claude разбирает; queued — сверх лимита на сутки; commented — повтор в открытую. */
  action: "created" | "queued" | "commented";
  url: string;
}

const ICON = { critical: "🔴", warning: "🟡" } as const;

/** Невидимый маркер в теле задачи: по нему повтор находит открытую задачу той же тревоги. */
export const alertMarker = (key: string) =>
  `<!-- alert:${key.replace(/-{2,}/g, "-")} -->`;

/** Без @-упоминаний и ссылок #N в markdown GitHub: текст тревоги и разбора — не наш. */
const plain = (s: string) =>
  s.replaceAll("@", "@\u200b").replace(/#(\d)/g, "#\u200b$1");

/** Тройные кавычки из журнала сломали бы блок кода в markdown. */
const fence = (s: string) => s.replaceAll("```", "ʼʼʼ");

/** Записи журнала, относящиеся к этой тревоге: по событию или пути API. */
function relevant(issue: Issue, samples: SampleLog[]): SampleLog[] {
  const { event, path } = issue.match ?? {};
  if (event) return samples.filter((s) => s.event === event);
  if (path) return samples.filter((s) => s.message.includes(path));
  return [];
}

const sampleLine = (s: SampleLog) =>
  `${s.ts} ${s.level} ${s.event} — ${s.message.slice(0, 400)}${s.error ? ` (${s.error.slice(0, 300)})` : ""}`;

/** Заголовок и тело задачи по новой тревоге (markdown GitHub). Чистая функция. */
export function formatAlertIssue(
  issue: Issue,
  analysis: string | null,
  samples: SampleLog[],
  logsUrl: string | null,
): { title: string; body: string } {
  const logs = relevant(issue, samples);
  const lines = [
    alertMarker(issue.key),
    `${ICON[issue.severity]} **${plain(issue.title)}**`,
    "",
    `- Детали: ${plain(issue.details)}`,
    `- Ключ тревоги: \`${issue.key}\``,
    "",
    "### Разбор ИИ",
    analysis ? plain(analysis) : "_нет (ИИ не настроен или не ответил)_",
    "",
    `### Журнал: свежие warn/error (${logs.length})`,
    ...(logs.length
      ? ["```text", ...logs.map((s) => fence(sampleLine(s))), "```"]
      : ["_записей нет_"]),
    ...(logsUrl ? ["", `Журнал на сайте: ${logsUrl}`] : []),
  ];
  return { title: issue.title, body: lines.join("\n") };
}

/**
 * Комментарий в открытую задачу, когда та же тревога пришла снова (spec 0037, сценарий 3):
 * «повтор: 5 ответов 5xx за 15 мин», второй строкой — время.
 */
export const formatAlertRepeat = (issue: Issue, now: number): string =>
  `повтор: ${plain(issue.details)}\n${new Date(now).toISOString()}`;
