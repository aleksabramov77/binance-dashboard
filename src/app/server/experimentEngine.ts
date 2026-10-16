// Композиция движка лаборатории (spec 003, задача 2b) для Node-сервера (VM): таймер, тумблер, статус.
// Сам тик (блокировка, хранилище, TickDeps) — общий среда-независимый engineTick.ts; его же вызывает
// Edge Function Supabase (spec 007b). Только сервер.
import {
  createDbExperimentStore,
  type EngineExposure,
  type EngineStatus,
  engineTickSchema,
  type OnInvalidExperiment,
  type RunParam,
  readEngineExposure,
  readExperimentDetail,
  readExperimentsOverview,
  readTradeStats,
  type StatsQuery,
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
import type { FuturesMarket, Perpetuals } from "@/shared/api/binance";
import {
  fetch24hTickers,
  fetchCoinmTickers,
  fetchFundingRates,
  fetchKlines,
  fetchPerpetuals,
} from "@/shared/api/binance/public.server";
import { sendTelegramMessage } from "@/shared/api/telegram";
import {
  getDemoTradingConfig,
  getRunnerRole,
  getTelegramConfig,
} from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { flushLogs, log } from "@/shared/lib/logger.server";
import {
  createPerpetualsSources,
  type EngineTickEnv,
  prepareEngineDb,
  runEngineTick,
} from "./engineTick";
import {
  announceEngineToggle,
  type EngineToggleActor,
} from "./engineToggleNotice";

const MINUTE = 60_000;
/** Тик — через несколько секунд после начала минуты: Binance успевает закрыть свечу. */
const TICK_OFFSET_MS = 5_000;
/** Справочник бессрочных фьючерсов меняется редко. */
const PERPETUALS_TTL_MS = 60 * MINUTE;

interface EngineProcess {
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<TickResult> | null;
  /** Операция, которая не должна идти параллельно с тиком (сброс эпохи); тики ждут её. */
  exclusive: Promise<unknown> | null;
  ready: Promise<void> | null;
  cache: CandleCache;
  perpetuals: (market: FuturesMarket) => Promise<Perpetuals>;
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
    exclusive: null,
    ready: null,
    cache: new Map(),
    // Юниверс лаборатории — только крипта: без индексов и токенов реальных активов (spec 0029).
    perpetuals: createPerpetualsSources(
      (m) => fetchPerpetuals(m, { cryptoOnly: true }),
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
    market: {
      fetchKlines,
      fetch24hTickers,
      fetchCoinmTickers,
      fetchFundingRates,
    },
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
    // Идёт сброс эпохи — тик ждёт его и работает уже по новой эпохе.
    await e.exclusive?.catch(() => undefined);
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

/**
 * Выполнить fn под блокировкой тика (сброс эпохи): дождаться текущего тика и предыдущей такой
 * операции; новые тики ждут, пока fn не закончится. Вызовы идут строго по очереди.
 * Блокировка — на процесс; тик другого раннера (Supabase) отсекается проверкой runner в тике.
 */
export function withTickLock<T>(fn: () => Promise<T>): Promise<T> {
  const e = engine();
  // Ждём только начатое до нас: новые тики сами ждут e.exclusive (иначе взаимная блокировка).
  const before = [e.exclusive, e.running];
  const run = (async () => {
    for (const p of before) await p?.catch(() => undefined);
    return fn();
  })();
  e.exclusive = run;
  run
    .finally(() => {
      if (e.exclusive === run) e.exclusive = null;
    })
    .catch(() => undefined);
  return run;
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

/** Отложенная работа после ответа; вне запроса Next — сразу. */
export type Defer = (task: () => Promise<void>) => void;
const runNow: Defer = (task) => {
  void task();
};

/** Открытые paper-сделки и демо-позиции — для модалки выключения «Автоторговли» (spec 0044). */
export async function getEngineExposure(): Promise<EngineExposure> {
  return readEngineExposure(getDb());
}

function telegramSender(): ((text: string) => Promise<void>) | null {
  const telegram = getTelegramConfig();
  const chatId = telegram?.chatId;
  if (!telegram || !chatId) return null;
  return (text) => sendTelegramMessage(telegram.token, chatId, text);
}

/**
 * Тумблер «Автоторговля» лаборатории. Включили — первый тик сразу, не дожидаясь минуты.
 * Каждое переключение — запись engine.toggle (кто, сколько позиций осталось без проверки) и
 * уведомление в Telegram после ответа (spec 0044); сбой подсчёта или Telegram тумблер не роняет.
 */
export async function setEngineEnabled(
  enabled: boolean,
  actor: EngineToggleActor,
  defer: Defer = runNow,
): Promise<EngineStatus> {
  await ensureEngineReady();
  await store().setState(ENGINE_KEYS.enabled, enabled);
  const exposure = enabled
    ? null
    : await getEngineExposure().catch((error: unknown) => {
        log.warn(
          "engine.toggle",
          "Не удалось посчитать открытые сделки для журнала",
          undefined,
          error,
        );
        return null;
      });
  announceEngineToggle(
    { enabled, ...actor, at: new Date(), exposure },
    {
      info: (event, message, data) => log.info(event, message, data),
      warn: (event, message, data) => log.warn(event, message, data),
      send: telegramSender(),
      // warn о сбое Telegram появляется уже после ответа — дописываем журнал сами.
      defer: (task) => defer(() => task().then(flushLogs)),
    },
  );
  if (enabled)
    tickExperimentEngine().catch((error) =>
      log.error("engine.tick", "Тик движка не выполнен", undefined, error),
    );
  return getEngineStatus();
}

/** Строка experiments не прошла строгую схему (spec 0029): страницы показывают остальные, строку — в журнал. */
export const warnInvalidExperiment: OnInvalidExperiment = ({ id, problem }) =>
  log.warn(
    "experiment.invalid",
    `эксперимент ${id} пропущен: конфиг не проходит схему`,
    { id, problem },
  );

/** Страница /experiments: каталог со статистикой периода (текущая эпоха, прошлая или все — spec 0046). */
export async function getExperimentsOverview(run?: RunParam) {
  await ensureEngineReady();
  return readExperimentsOverview(
    getDb(),
    await readEnabled(store()),
    getDemoTradingConfig() !== null,
    warnInvalidExperiment,
    run,
  );
}

/** Страница /experiments/[id] за период; null — эксперимента нет в каталоге. */
export async function getExperimentDetail(
  id: string,
  limit: number,
  run?: RunParam,
) {
  await ensureEngineReady();
  return readExperimentDetail(
    getDb(),
    id,
    await readEnabled(store()),
    limit,
    warnInvalidExperiment,
    run,
  );
}

/** Страница /stats: разрезы сделок периода; несуществующая эпоха — текущая и missingRun. */
export async function getTradeStats(query: StatsQuery) {
  await ensureEngineReady();
  return readTradeStats(getDb(), query, Date.now(), warnInvalidExperiment);
}
