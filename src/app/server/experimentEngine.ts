// Композиция движка лаборатории (spec 003, задача 2b) для Node-сервера (VM): тик из features/paper-engine
// получает хранилище на Drizzle (entities/experiment), публичные данные Binance без ключей и таймер.
// Только сервер. Edge Function Supabase (spec 007b) собирает те же зависимости по-своему.
import {
  createDbExperimentStore,
  type EngineStatus,
  engineTickSchema,
  ensureRun,
  readExperimentDetail,
  readExperimentsOverview,
  readTradeStats,
  type StatsQuery,
  seedExperiments,
} from "@/entities/experiment";
import {
  type CandleCache,
  ENGINE_KEYS,
  EXPERIMENT_CATALOG,
  type ExperimentStore,
  readEnabled,
  readRunner,
  runTick,
  type TickDeps,
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
  perpetuals: { at: number; symbols: Set<string> } | null;
  warnedRunner: boolean;
}

// Один таймер, одна блокировка тика и один кэш свечей на процесс: в dev instrumentation и роуты —
// разные бандлы, поэтому состояние в globalThis.
const key = Symbol.for("binance-dashboard.experimentEngine");
type GlobalWithEngine = typeof globalThis & { [key]?: EngineProcess };
const g = globalThis as GlobalWithEngine;

function engine(): EngineProcess {
  g[key] ??= {
    timer: null,
    running: null,
    ready: null,
    cache: new Map(),
    perpetuals: null,
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
    const db = getDb();
    await seedExperiments(db, EXPERIMENT_CATALOG);
    await ensureRun(db);
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

async function perpetualSymbols(): Promise<Set<string>> {
  const e = engine();
  const now = Date.now();
  if (e.perpetuals && now - e.perpetuals.at < PERPETUALS_TTL_MS)
    return e.perpetuals.symbols;
  try {
    const symbols = await fetchPerpetualSymbols();
    e.perpetuals = { at: now, symbols };
    return symbols;
  } catch (error) {
    // Справочник не обновился — работаем по старому, если он есть.
    if (e.perpetuals) return e.perpetuals.symbols;
    throw error;
  }
}

function deps(): TickDeps {
  return {
    runner: runnerRole(),
    store: store(),
    candles: (market, symbol, interval, limit) =>
      fetchKlines(market, symbol, interval, Math.min(limit, 1000)),
    tickers: async (market) => {
      const list = await fetch24hTickers(market);
      if (market === "spot") return list;
      const perps = await perpetualSymbols();
      return list.filter((t) => perps.has(t.symbol));
    },
    funding: fetchFundingRates,
    cache: engine().cache,
    log: (level, event, message, data) => log[level](event, message, data),
  };
}

/** Один тик под блокировкой процесса: таймер и /api/cron/tick не выполняются параллельно. */
export function tickExperimentEngine(): Promise<TickResult> {
  const e = engine();
  e.running ??= (async () => {
    await ensureEngineReady();
    const started = Date.now();
    const result = await runTick(deps(), started);
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

/** Страница /experiments: каталог со статистикой текущей эпохи. */
export async function getExperimentsOverview() {
  await ensureEngineReady();
  return readExperimentsOverview(getDb(), await readEnabled(store()));
}

/** Страница /experiments/[id]; null — эксперимента нет в каталоге. */
export async function getExperimentDetail(id: string, limit: number) {
  await ensureEngineReady();
  return readExperimentDetail(getDb(), id, await readEnabled(store()), limit);
}

/** Страница /stats: разрезы сделок эпохи; null — нет такой эпохи. */
export async function getTradeStats(query: StatsQuery) {
  await ensureEngineReady();
  return readTradeStats(getDb(), query, Date.now());
}
