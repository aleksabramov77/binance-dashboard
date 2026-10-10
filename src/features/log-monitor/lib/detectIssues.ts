import { MONITOR, type MonitorRules } from "../config/rules";

/** Срез состояния сервиса за окно проверки. */
export interface MonitorSnapshot {
  now: number;
  /** Ошибки (level=error) по событиям: за окно и за сутки до окна. */
  errorsByEvent: { event: string; window: number; baseline: number }[];
  /** Ответы 5xx по путям API за окно. */
  http5xxByPath: { path: string; window: number }[];
  /** Движок лаборатории; null — состояние не прочитано. */
  engine: {
    enabled: boolean;
    lastTickAt: number | null;
    lastErrors: number;
  } | null;
  /** Упавшие запуски заданий pg_cron за окно. */
  cronFailures: { job: string; failed: number; lastMessage: string | null }[];
  /** Время последнего снимка Earn; null — снимков нет. */
  earnLastAt: number | null;
}

export interface Issue {
  /** Стабильный ключ: по нему не дублируем уведомления. */
  key: string;
  severity: "critical" | "warning";
  title: string;
  details: string;
  /** Что искать в журнале для примеров (событие или путь API). */
  match?: { event?: string; path?: string };
}

const minutes = (ms: number) => Math.round(ms / 60_000);

/** Правила «что-то сломалось». Чистая функция: тот же срез — те же проблемы. */
export function detectIssues(
  s: MonitorSnapshot,
  rules: MonitorRules = MONITOR,
): Issue[] {
  const issues: Issue[] = [];
  const windowsInBaseline = rules.baselineMs / rules.windowMs;

  for (const { path, window } of s.http5xxByPath)
    if (window >= rules.http5xxPerPath)
      issues.push({
        key: `http5xx:${path}`,
        severity: "critical",
        title: `Ручка ${path} отвечает ошибками`,
        details: `${window} ответов 5xx за ${minutes(rules.windowMs)} мин`,
        match: { path },
      });

  for (const { event, window, baseline } of s.errorsByEvent) {
    // http — уже покрыт правилом 5xx по путям.
    if (event === "http") continue;
    const usual = baseline / windowsInBaseline;
    if (window < rules.errorBurst || window < rules.errorBurstFactor * usual)
      continue;
    issues.push({
      key: `errors:${event}`,
      severity: window >= rules.errorBurst * 3 ? "critical" : "warning",
      title: `Всплеск ошибок «${event}»`,
      details: `${window} за ${minutes(rules.windowMs)} мин (обычно ~${usual.toFixed(1)})`,
      match: { event },
    });
  }

  const e = s.engine;
  if (e?.enabled) {
    const age = e.lastTickAt === null ? null : s.now - e.lastTickAt;
    if (age === null || age > rules.engineStaleMs)
      issues.push({
        key: "engine:stalled",
        severity: "critical",
        title: "Движок экспериментов не тикает",
        details:
          age === null
            ? "тиков ещё не было, хотя автоторговля включена"
            : `последний тик ${minutes(age)} мин назад`,
        match: { event: "engine.tick" },
      });
    else if (e.lastErrors > 0)
      issues.push({
        key: "engine:errors",
        severity: "warning",
        title: "Тик движка с ошибками",
        details: `ошибок в последнем тике: ${e.lastErrors}`,
        match: { event: "engine.tick" },
      });
  }

  for (const { job, failed, lastMessage } of s.cronFailures)
    if (failed > 0)
      issues.push({
        key: `cron:${job}`,
        severity: "critical",
        title: `Расписание «${job}» падает`,
        details: `неудачных запусков: ${failed}${lastMessage ? ` — ${lastMessage.slice(0, 160)}` : ""}`,
      });

  if (s.earnLastAt === null || s.now - s.earnLastAt > rules.earnStaleMs)
    issues.push({
      key: "earn:stale",
      severity: "warning",
      title: "Снимки Earn не обновляются",
      details:
        s.earnLastAt === null
          ? "снимков нет"
          : `последний снимок ${Math.round((s.now - s.earnLastAt) / 3_600_000)} ч назад`,
      match: { event: "cron.earn" },
    });

  return issues;
}
