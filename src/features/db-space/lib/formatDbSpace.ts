import { spaceAlertTitle } from "./planSpaceAlerts";

export interface DbTableSize {
  /** Имя таблицы; не из схемы public — со схемой (auth.users). */
  name: string;
  bytes: number;
}

/** Замер места: размер базы, лимит и самые большие таблицы (по убыванию). */
export interface DbUsage {
  usedBytes: number;
  limitBytes: number;
  tables: DbTableSize[];
}

const MB = 1024 * 1024;

/** Свободно, % от лимита; при превышении лимита — меньше нуля. */
export const freePctOf = (usage: DbUsage): number =>
  ((usage.limitBytes - usage.usedBytes) / usage.limitBytes) * 100;

const number = (value: number, digits: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
    value,
  );

/** 312 МБ, 4,2 МБ, 0,35 МБ: мелкие значения — с дробной частью. */
export function formatMb(bytes: number): string {
  const mb = bytes / MB;
  const abs = Math.abs(mb);
  return `${number(mb, abs < 1 ? 2 : abs < 10 ? 1 : 0)} МБ`;
}

const formatPct = (pct: number) => `${number(pct, pct < 10 ? 1 : 0)} %`;

function summary(usage: DbUsage): string {
  const free = usage.limitBytes - usage.usedBytes;
  const text = `занято ${formatMb(usage.usedBytes)} из ${formatMb(usage.limitBytes)}, свободно ${formatMb(Math.max(0, free))} (${formatPct(Math.max(0, freePctOf(usage)))})`;
  return free < 0 ? `${text}, лимит превышен на ${formatMb(-free)}` : text;
}

function tables(usage: DbUsage): string[] {
  if (!usage.tables.length) return [];
  return [
    "Самые большие таблицы:",
    ...usage.tables.map((t) => `• ${t.name} — ${formatMb(t.bytes)}`),
  ];
}

/** Ответ на /db (Telegram, без разметки). */
export function formatDbSpace(usage: DbUsage): string {
  return [`💾 База: ${summary(usage)}`, ...tables(usage)].join("\n");
}

/** Уведомление о пройденном пороге свободного места. */
export function formatSpaceAlert(
  threshold: number,
  usage: DbUsage,
  logsUrl: string | null,
): string {
  const text = summary(usage);
  return [
    `⚠️ ${spaceAlertTitle(threshold)}`,
    `${text.charAt(0).toUpperCase()}${text.slice(1)}.`,
    ...tables(usage),
    ...(logsUrl ? ["", `Журнал: ${logsUrl}`] : []),
  ].join("\n");
}
