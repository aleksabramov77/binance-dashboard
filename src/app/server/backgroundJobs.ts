// Фоновые задачи своей VM (spec 0048): те же задачи, что pg_cron вызывает роутами /api/cron/* на Vercel, —
// по таймерам процесса. Работают, только когда engine_state.runner = роль процесса (ENGINE_RUNNER), иначе
// пропуск без записей в БД. Логика задач — общая с роутами. Только сервер, только вне Vercel.
import { createDbExperimentStore } from "@/entities/experiment";
import { collectSnapshot } from "@/features/collect-snapshot";
import { readRunner } from "@/features/paper-engine";
import {
  getAppHost,
  getRunnerRole,
  isServerless,
  type RunnerRole,
} from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import {
  BACKGROUND_JOBS,
  type BackgroundJobConfig,
  type BackgroundJobId,
  type CronSchedule,
  nextRunAt,
  parseCron,
} from "./backgroundSchedule";
import { checkDbSpaceSafe } from "./dbSpace";
import { runDemoMirror } from "./demoMirror";
import { runLogMonitor } from "./logMonitor";
import { runMirrorAuto } from "./mirrorAuto";

export interface BackgroundJob extends BackgroundJobConfig {
  /** Тот же вызов, что в роуте; результат — короткая сводка для журнала. */
  run: () => Promise<Record<string, unknown> | undefined>;
}

/** Условия запуска: не Vercel и роль процесса совпадает с engine_state.runner. */
export interface JobGate {
  serverless: () => boolean;
  processRunner: () => RunnerRole;
  dbRunner: () => Promise<RunnerRole>;
}

type Writer = (
  event: string,
  message: string,
  data?: Record<string, unknown>,
  error?: unknown,
) => void;
export interface JobLog {
  debug: Writer;
  info: Writer;
  warn: Writer;
  error: Writer;
}

export type JobOutcome =
  | "done"
  | "failed"
  | "skipped-serverless"
  | "skipped-running"
  | "skipped-runner"
  | "skipped-runner-unknown";

const SKIP_TEXT = {
  "skipped-serverless": "процесс на Vercel — задачи запускает pg_cron",
  "skipped-running": "прошлый запуск ещё идёт",
  "skipped-runner": "задачи выполняет другой раннер",
  "skipped-runner-unknown":
    "раннер неизвестен — engine_state.runner не прочитан",
} as const;
type SkipOutcome = keyof typeof SKIP_TEXT;

/** Состояние задач процесса: идущие запуски и последняя причина пропуска (строка — только при её смене). */
export interface JobsState {
  running: Set<BackgroundJobId>;
  skipped: Map<BackgroundJobId, SkipOutcome>;
}

export const createJobsState = (): JobsState => ({
  running: new Set(),
  skipped: new Map(),
});

/**
 * Один запуск задачи. Пропуск — запись debug (в БД не пишется) только при смене состояния: первый пропуск после
 * старта или запуска, смена причины; снова запустилась после пропусков — одна строка. Не прочитан
 * engine_state.runner (БД недоступна) — отдельный пропуск «раннер неизвестен»: одна запись warn при смене состояния,
 * не error задачи на каждый запуск (монитор не шлёт тревогу каждую минуту). Сбой самой задачи — запись error с
 * событием роута, наружу не бросает: процесс и другие задачи продолжают работу.
 */
export async function runBackgroundJob(
  job: BackgroundJob,
  state: JobsState,
  gate: JobGate,
  logger: JobLog,
  now: () => number = Date.now,
): Promise<JobOutcome> {
  const skip = (
    outcome: SkipOutcome,
    data?: Record<string, unknown>,
    error?: unknown,
  ) => {
    if (state.skipped.get(job.id) !== outcome) {
      const message = `${job.id}: пропуск — ${SKIP_TEXT[outcome]} (дальше без повторов, до смены состояния)`;
      const fields = { job: job.id, reason: outcome, ...data };
      if (outcome === "skipped-runner-unknown")
        logger.warn(job.event, message, fields, error);
      else logger.debug(job.event, message, fields);
    }
    state.skipped.set(job.id, outcome);
    return outcome;
  };
  const resumed = () => {
    if (!state.skipped.delete(job.id)) return;
    logger.debug(job.event, `${job.id}: задача снова выполняется`, {
      job: job.id,
    });
  };
  if (gate.serverless()) return skip("skipped-serverless");
  if (state.running.has(job.id)) return skip("skipped-running");
  state.running.add(job.id);
  const started = now();
  try {
    const processRunner = gate.processRunner();
    let dbRunner: RunnerRole;
    try {
      dbRunner = await gate.dbRunner();
    } catch (error) {
      return skip("skipped-runner-unknown", { processRunner }, error);
    }
    if (dbRunner !== processRunner)
      return skip("skipped-runner", { processRunner, dbRunner });
    resumed();
    const summary = await job.run();
    if (!job.quiet) {
      const ms = now() - started;
      logger.info(job.event, `${job.id}: выполнено за ${ms} мс`, {
        job: job.id,
        ms,
        ...summary,
      });
    }
    return "done";
  } catch (error) {
    logger.error(
      job.event,
      `${job.id}: фоновая задача не выполнена`,
      { job: job.id, ms: now() - started },
      error,
    );
    return "failed";
  } finally {
    state.running.delete(job.id);
  }
}

const RUNS: Record<BackgroundJobId, BackgroundJob["run"]> = {
  "earn-snapshot": async () => {
    const { snapshot } = await collectSnapshot();
    return { fetchedAt: snapshot.fetchedAt, offers: snapshot.offers.length };
  },
  "log-monitor": async () => {
    const r = await runLogMonitor();
    const dbSpace = await checkDbSpaceSafe();
    return { issues: r.issues.length, sent: r.sent, dbSpace };
  },
  // Межпроцессная блокировка зеркала — внутри runDemoMirror; таймер её не обходит.
  "demo-mirror": async () => {
    await runDemoMirror();
    return undefined;
  },
  "mirror-auto": async () => {
    const r = await runMirrorAuto();
    return { checked: r.checked, changes: r.changes.length };
  },
};

export const backgroundJobs = (): BackgroundJob[] =>
  BACKGROUND_JOBS.map((config) => ({ ...config, run: RUNS[config.id] }));

const realGate: JobGate = {
  serverless: () => isServerless(),
  processRunner: () => getRunnerRole().role,
  dbRunner: () => readRunner(createDbExperimentStore(getDb())),
};

const realLog: JobLog = {
  // debug логгер не печатает в консоль, а файл data/logs на VM недоступен (ProtectSystem=strict) — пропуск
  // печатаем сами, чтобы он был виден в journalctl; в БД debug не пишется.
  debug: (event, message, data) => {
    log.debug(event, message, data);
    console.log(`[log] · ${event}: ${message}`);
  },
  info: (event, message, data) => log.info(event, message, data),
  warn: (event, message, data, error) => log.warn(event, message, data, error),
  error: (event, message, data, error) =>
    log.error(event, message, data, error),
};

interface JobsProcess {
  timers: Map<BackgroundJobId, ReturnType<typeof setTimeout>>;
  state: JobsState;
}

// Одни таймеры на процесс: в dev instrumentation и роуты — разные бандлы, поэтому состояние в globalThis.
const key = Symbol.for("binance-dashboard.backgroundJobs");
const g = globalThis as typeof globalThis & { [key]?: JobsProcess };

function jobsProcess(): JobsProcess {
  g[key] ??= { timers: new Map(), state: createJobsState() };
  return g[key];
}

/** Задача с расписанием, разобранным один раз при старте (колбэк таймера cron не разбирает). */
export interface ScheduledJob {
  job: BackgroundJob;
  schedule: CronSchedule;
}

/** Разбор расписаний всех задач — один раз; ошибка в cron видна сразу при старте. */
export const scheduleJobs = (jobs: BackgroundJob[]): ScheduledJob[] =>
  jobs.map((job) => ({ job, schedule: parseCron(job.cron) }));

/** Таймер следующего запуска; новый ставится до запуска — долгая задача не сдвигает расписание. */
function schedule(p: JobsProcess, item: ScheduledJob, after: number) {
  const { job } = item;
  const target = nextRunAt(item.schedule, after, job.offsetMs);
  const timer = setTimeout(
    () => {
      // Таймер мог сработать чуть раньше цели — следующий считаем от неё, чтобы не повторить тот же слот.
      schedule(p, item, Math.max(Date.now(), target));
      void runBackgroundJob(job, p.state, realGate, realLog);
    },
    Math.max(0, target - Date.now()),
  );
  // Таймер не держит процесс (тесты, остановка сервера).
  timer.unref?.();
  p.timers.set(job.id, timer);
}

/**
 * Таймеры фоновых задач (один набор на процесс). Только на своей VM (APP_HOST=vm): на Mac роль процесса и runner
 * локальной PGlite по умолчанию совпадают (oracle), и монитор слал бы Telegram и задачи GitHub ключами из .env.local.
 * Выполнять ли задачу — решает engine_state.runner перед каждым запуском.
 */
export function startBackgroundJobs(): void {
  if (getAppHost() !== "vm") return;
  const p = jobsProcess();
  if (p.timers.size > 0) return;
  const jobs = scheduleJobs(backgroundJobs());
  for (const item of jobs) schedule(p, item, Date.now());
  log.info("jobs.start", "Таймеры фоновых задач запущены", {
    runner: getRunnerRole().role,
    jobs: jobs.map(({ job }) => `${job.id} ${job.cron}`),
  });
}
