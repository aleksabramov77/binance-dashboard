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
  error: Writer;
}

export type JobOutcome =
  | "done"
  | "failed"
  | "skipped-serverless"
  | "skipped-running"
  | "skipped-runner";

const SKIP_TEXT = {
  "skipped-serverless": "процесс на Vercel — задачи запускает pg_cron",
  "skipped-running": "прошлый запуск ещё идёт",
  "skipped-runner": "задачи выполняет другой раннер",
} as const;

/**
 * Один запуск задачи. Пропуск — одна запись debug (в БД не пишется); сбой — запись error с событием роута,
 * наружу не бросает: процесс и другие задачи продолжают работу. running — задачи, идущие в этом процессе.
 */
export async function runBackgroundJob(
  job: BackgroundJob,
  running: Set<BackgroundJobId>,
  gate: JobGate,
  logger: JobLog,
  now: () => number = Date.now,
): Promise<JobOutcome> {
  const skip = (
    outcome: keyof typeof SKIP_TEXT,
    data?: Record<string, unknown>,
  ) => {
    logger.debug(job.event, `${job.id}: пропуск — ${SKIP_TEXT[outcome]}`, {
      job: job.id,
      ...data,
    });
    return outcome;
  };
  if (gate.serverless()) return skip("skipped-serverless");
  if (running.has(job.id)) return skip("skipped-running");
  running.add(job.id);
  const started = now();
  try {
    const processRunner = gate.processRunner();
    const dbRunner = await gate.dbRunner();
    if (dbRunner !== processRunner)
      return skip("skipped-runner", { processRunner, dbRunner });
    const summary = await job.run();
    if (!job.quiet)
      logger.info(job.event, `${job.id}: выполнено за ${now() - started} мс`, {
        job: job.id,
        ms: now() - started,
        ...summary,
      });
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
    running.delete(job.id);
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
  error: (event, message, data, error) =>
    log.error(event, message, data, error),
};

interface JobsProcess {
  timers: Map<BackgroundJobId, ReturnType<typeof setTimeout>>;
  running: Set<BackgroundJobId>;
}

// Одни таймеры на процесс: в dev instrumentation и роуты — разные бандлы, поэтому состояние в globalThis.
const key = Symbol.for("binance-dashboard.backgroundJobs");
const g = globalThis as typeof globalThis & { [key]?: JobsProcess };

function jobsProcess(): JobsProcess {
  g[key] ??= { timers: new Map(), running: new Set() };
  return g[key];
}

/** Таймер следующего запуска; новый ставится до запуска — долгая задача не сдвигает расписание. */
function schedule(p: JobsProcess, job: BackgroundJob, after: number) {
  const target = nextRunAt(parseCron(job.cron), after, job.offsetMs);
  const timer = setTimeout(
    () => {
      // Таймер мог сработать чуть раньше цели — следующий считаем от неё, чтобы не повторить тот же слот.
      schedule(p, job, Math.max(Date.now(), target));
      void runBackgroundJob(job, p.running, realGate, realLog);
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
  const jobs = backgroundJobs();
  for (const job of jobs) schedule(p, job, Date.now());
  log.info("jobs.start", "Таймеры фоновых задач запущены", {
    runner: getRunnerRole().role,
    jobs: jobs.map((j) => `${j.id} ${j.cron}`),
  });
}
