// Композиция движка лаборатории (spec 003, задача 2b) для Node-сервера (VM): таймер, тумблер, статус.
// Сам тик (блокировка, хранилище, TickDeps) — общий среда-независимый engineTick.ts; его же вызывает
// Edge Function Supabase (spec 007b). Только сервер.
import {
  createDbExperimentStore,
  type EngineStatus,
  engineTickSchema,
} from "@/entities/experiment";
import {
  type CandleCache,
  ENGINE_KEYS,
  EXPERIMENT_CATALOG,
  type ExperimentStore,
  readEnabled,
  readRunner,
  type TickResult,
} from "@/features/paper-engine";
import {
  fetch24hTickers,
  fetchFundingRates,
  fetchKlines,
  fetchPerpetualSymbols,
} from "@/shared/api/binance/public.server";
import { getRunnerRole } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import {
  createPerpetualsSource,
  type EngineTickEnv,
  prepareEngineDb,
  runEngineTick,
} from "./engineTick";

const MINUTE = 60_000;
/** Тик — через несколько секунд после начала минуты: Binance успевает закрыть свечу. */
const TICK_OFFSET_MS = 5_000;
/** Справочник бессрочных фьючерсов меняется редко. */
const PERPETUALS_TTL_MS = 60 * MINUTE;

interface EngineProcess {
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<TickResult> | null;
  ready: Promise<void> | null;
  cache: CandleCache;
  perpetuals: () => Promise<Set<string>>;
  warnedRunner: boolean;
}

// Один таймер, одна блокировка тика и один кэш свечей на процесс: в dev instrumentation и роуты —
// разные бандлы, поэтому состояние в globalThis (как у features/auto-trade).
const key = Symbol.for("binance-dashboard.experimentEngine");
type GlobalWithEngine = typeof globalThis & { [key]?: EngineProcess };
const g = globalThis as GlobalWithEngine;

function engine(): EngineProcess {
  g[key] ??= {
    timer: null,
    running: null,
    ready: null,
    cache: new Map(),
    perpetuals: createPerpetualsSource(
      fetchPerpetualSymbols,
      PERPETUALS_TTL_MS,
      Date.now,
    ),
    warnedRunner: false,
  };
  return g[key];
}

/** Роль раннера из ENGINE_RUNNER; неизвестное значение — oracle и одно предупреждение в журнал на процесс. */
function runnerRole() {
  const { role, invalid } = getRunnerRole();
  const e = engine();
  if (invalid !== null && !e.warnedRunner) {
    e.warnedRunner = true;
    log.warn(
      "engine.runner",
      `Неизвестный ENGINE_RUNNER="${invalid}" — использую oracle (допустимо: oracle, supabase)`,
    );
  }
  return role;
}

const store = (): ExperimentStore => createDbExperimentStore(getDb());

/** Сид каталога (upsert по id) и первая эпоха — один раз на процесс; сбой — повтор при следующем вызове. */
export function ensureEngineReady(): Promise<void> {
  const e = engine();
  e.ready ??= (async () => {
    await prepareEngineDb(getDb());
    log.info(
      "engine.seed",
      `Каталог: ${EXPERIMENT_CATALOG.length} экспериментов`,
    );
  })().catch((error) => {
    e.ready = null;
    throw error;
  });
  return e.ready;
}

function tickEnv(): EngineTickEnv {
  const e = engine();
  return {
    db: getDb(),
    runner: runnerRole(),
    market: { fetchKlines, fetch24hTickers, fetchFundingRates },
    perpetuals: e.perpetuals,
    cache: e.cache,
    log: (level, event, message, data) => log[level](event, message, data),
  };
}

/**
 * Один тик. Блокировка процесса — таймер и /api/cron/tick не выполняются параллельно; межпроцессная
 * (advisory lock в БД, runEngineTick) — с Edge Function Supabase и другими экземплярами сервера.
 */
export function tickExperimentEngine(): Promise<TickResult> {
  const e = engine();
  e.running ??= (async () => {
    await ensureEngineReady();
    const started = Date.now();
    const result = await runEngineTick(tickEnv(), started);
    if (result.status === "locked")
      log.info("engine.tick", "Тик пропущен: блокировку держит другой процесс");
    if (result.status === "ok" && (result.evaluated.length || result.closed))
      log.info(
        "engine.tick",
        `Тик: открыто ${result.opened}, закрыто ${result.closed}, свечи ${result.evaluated.length}`,
        { ...result, ms: Date.now() - started },
      );
    if (result.errors.length)
      log.warn("engine.tick", `Тик с ошибками: ${result.errors.length}`, {
        errors: result.errors.slice(0, 10),
      });
    return result;
  })().finally(() => {
    e.running = null;
  });
  return e.running;
}

function schedule(e: EngineProcess) {
  if (e.timer) clearTimeout(e.timer);
  const now = Date.now();
  const delay =
    Math.floor(now / MINUTE) * MINUTE + MINUTE + TICK_OFFSET_MS - now;
  e.timer = setTimeout(() => {
    tickExperimentEngine()
      .catch((error) =>
        log.error("engine.tick", "Тик движка не выполнен", undefined, error),
      )
      .finally(() => schedule(e));
  }, delay);
  // Таймер не держит процесс (тесты, остановка сервера).
  e.timer.unref?.();
}

/** Фоновый тик раз в минуту (один таймер на процесс). Включён ли движок — решает engine_state.enabled. */
export function startExperimentEngine(): void {
  const e = engine();
  if (e.timer) return;
  ensureEngineReady().catch((error) =>
    log.error(
      "engine.seed",
      "Каталог экспериментов не записан",
      undefined,
      error,
    ),
  );
  schedule(e);
  log.info("engine.start", "Таймер движка лаборатории запущен", {
    runner: runnerRole(),
  });
}

export async function getEngineStatus(): Promise<EngineStatus> {
  await ensureEngineReady();
  const s = store();
  const lastTick = engineTickSchema.safeParse(
    await s.getState(ENGINE_KEYS.lastTick),
  );
  return {
    enabled: await readEnabled(s),
    runner: await readRunner(s),
    processRunner: runnerRole(),
    lastTick: lastTick.success ? lastTick.data : null,
  };
}

/** Тумблер «Автоторговля» лаборатории. Включили — первый тик сразу, не дожидаясь минуты. */
export async function setEngineEnabled(
  enabled: boolean,
): Promise<EngineStatus> {
  await ensureEngineReady();
  await store().setState(ENGINE_KEYS.enabled, enabled);
  log.info(
    "engine.toggle",
    enabled ? "Движок лаборатории включён" : "Движок лаборатории выключен",
  );
  if (enabled)
    tickExperimentEngine().catch((error) =>
      log.error("engine.tick", "Тик движка не выполнен", undefined, error),
    );
  return getEngineStatus();
}
