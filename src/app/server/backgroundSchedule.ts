// Расписание фоновых задач VM (spec 0048): то же cron-выражение, что у pg_cron, — без внешних библиотек.
// Поддерживаются минуты и часы (`*`, `*/n`, число, список через запятую); день, месяц и день недели — только `*`.
// Время — UTC, как у pg_cron в Supabase. Чистые функции.

const MINUTE = 60_000;
/** Дальше двух суток расписания из минут и часов не уходят — предел перебора. */
const SEARCH_MINUTES = 2 * 24 * 60;

export interface CronSchedule {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
}

function parseField(
  field: string,
  max: number,
  expr: string,
): ReadonlySet<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const step = /^\*\/(\d+)$/.exec(part);
    if (part === "*" || step) {
      const n = step ? Number(step[1]) : 1;
      if (n < 1) throw new Error(`Шаг 0 в cron-выражении "${expr}"`);
      for (let v = 0; v <= max; v += n) values.add(v);
      continue;
    }
    if (!/^\d+$/.test(part) || Number(part) > max)
      throw new Error(`Не поддерживается поле "${part}" в "${expr}"`);
    values.add(Number(part));
  }
  return values;
}

/** Разбор `мин час день месяц день_недели`; день, месяц и день недели — только `*`. */
export function parseCron(expr: string): CronSchedule {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error(`В cron-выражении "${expr}" должно быть 5 полей`);
  const [minute, hour, ...rest] = fields;
  if (rest.some((f) => f !== "*"))
    throw new Error(
      `Поддерживаются только минуты и часы, остальное "*": "${expr}"`,
    );
  return {
    minutes: parseField(minute, 59, expr),
    hours: parseField(hour, 23, expr),
  };
}

/**
 * Ближайший запуск строго позже now (мс): начало подходящей минуты UTC плюс offsetMs (0 ≤ offsetMs < минуты).
 * Смещение разводит задачи одной минуты: демо-зеркало идёт после тика движка.
 */
export function nextRunAt(
  schedule: CronSchedule,
  now: number,
  offsetMs = 0,
): number {
  if (offsetMs < 0 || offsetMs >= MINUTE)
    throw new Error(`Смещение ${offsetMs} мс вне минуты`);
  let minuteStart = Math.floor((now - offsetMs) / MINUTE) * MINUTE;
  for (let i = 0; i <= SEARCH_MINUTES; i++) {
    const at = minuteStart + offsetMs;
    const d = new Date(minuteStart);
    if (
      at > now &&
      schedule.minutes.has(d.getUTCMinutes()) &&
      schedule.hours.has(d.getUTCHours())
    )
      return at;
    minuteStart += MINUTE;
  }
  throw new Error("Расписание не срабатывает в ближайшие двое суток");
}

/** Фоновые задачи VM: id — имя задания pg_cron (supabase/migrations/*_cron.sql), расписание — то же. */
export type BackgroundJobId =
  | "earn-snapshot"
  | "log-monitor"
  | "demo-mirror"
  | "mirror-auto";

export interface BackgroundJobConfig {
  id: BackgroundJobId;
  /** Как у pg_cron, UTC. */
  cron: string;
  /** Смещение от начала минуты. */
  offsetMs: number;
  /** Событие журнала — как у роута /api/cron/<id>. */
  event: string;
  /** Успешный прогон в журнал не пишется (как `quiet` у роута); ошибки пишутся всегда. */
  quiet: boolean;
}

export const BACKGROUND_JOBS: readonly BackgroundJobConfig[] = [
  {
    id: "earn-snapshot",
    cron: "0 3,15 * * *",
    offsetMs: 0,
    event: "cron.earn",
    quiet: false,
  },
  {
    id: "log-monitor",
    cron: "*/15 * * * *",
    offsetMs: 0,
    event: "cron.monitor",
    quiet: true,
  },
  // Тик движка — на 5-й секунде минуты (experimentEngine.ts); зеркало повторяет его свежие входы.
  {
    id: "demo-mirror",
    cron: "* * * * *",
    offsetMs: 20_000,
    event: "cron.mirror",
    quiet: true,
  },
  {
    id: "mirror-auto",
    cron: "0 7 * * *",
    offsetMs: 0,
    event: "cron.mirror_auto",
    quiet: false,
  },
];
