import { LOG_LEVELS, type LogLevel } from "./schema";

// Фильтры страницы /logs и GET /api/logs — в URL (spec 0016): уровень, события, эксперимент, период.

export const LOG_DAYS_DEFAULT = 2;
export const LOG_DAYS_MAX = 14;
export const MIRROR_LOG_EVENTS = ["mirror.rejected", "mirror.skipped"] as const;
/**
 * Отказы и пропуски реального счёта (spec 0049) — ссылка из Real-колонок /experiments (spec 0054). Пропуск ставит и
 * сверка «потерянного» входа — она пишет live.reconcile.
 */
export const LIVE_LOG_EVENTS = [
  "live.rejected",
  "live.skipped",
  "live.reconcile",
] as const;

export interface LogFilters {
  level: LogLevel;
  /** Точные имена событий; пусто — все. */
  events: string[];
  /** data.experimentId; пусто — все. */
  experiment: string;
  /** Глубина в сутках, 1…LOG_DAYS_MAX. */
  days: number;
}

export const DEFAULT_LOG_FILTERS: LogFilters = {
  level: "info",
  events: [],
  experiment: "",
  days: LOG_DAYS_DEFAULT,
};

export function parseLogFilters(params: URLSearchParams): LogFilters {
  const level = LOG_LEVELS.find((l) => l === params.get("level")) ?? "info";
  const events = (params.get("event") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const experiment = (params.get("experiment") ?? "").trim();
  const raw = Number.parseInt(params.get("days") ?? "", 10);
  const days = Number.isNaN(raw)
    ? LOG_DAYS_DEFAULT
    : Math.min(LOG_DAYS_MAX, Math.max(1, raw));
  return { level, events, experiment, days };
}

export function logFiltersSearch(f: Partial<LogFilters>): string {
  const p = new URLSearchParams();
  if (f.level && f.level !== DEFAULT_LOG_FILTERS.level) p.set("level", f.level);
  if (f.events?.length) p.set("event", f.events.join(","));
  if (f.experiment) p.set("experiment", f.experiment);
  if (f.days && f.days !== LOG_DAYS_DEFAULT) p.set("days", String(f.days));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Ссылка из «N отказ · M пропуск»: отказы и пропуски зеркала одного эксперимента за всё время хранения. */
export const mirrorLogsHref = (experimentId: string) =>
  `/logs${logFiltersSearch({ events: [...MIRROR_LOG_EVENTS], experiment: experimentId, days: LOG_DAYS_MAX })}`;

/** То же для реального счёта (spec 0054): отказы и пропуски входов эксперимента на торговом субсчёте. */
export const liveLogsHref = (experimentId: string) =>
  `/logs${logFiltersSearch({ events: [...LIVE_LOG_EVENTS], experiment: experimentId, days: LOG_DAYS_MAX })}`;
