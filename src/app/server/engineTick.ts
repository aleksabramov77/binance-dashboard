// Общая композиция тика движка лаборатории (spec 003 2b, spec 007b): одна для VM (experimentEngine.ts,
// Node) и Edge Function Supabase (supabase/functions/engine-tick, Deno). Среда-независимая: без node:*,
// process.env, Next и таймеров — сеть, БД, часы и журнал приходят аргументами. Импорты — только
// public API слайсов и env-нейтральный shared/api/binance/marketApi (его Deno грузит исходником).
import {
  createDbExperimentStore,
  type ExperimentDb,
  ensureRun,
  seedExperiments,
  withEngineTickLock,
} from "@/entities/experiment";
import {
  type CandleCache,
  type EngineRunner,
  EXPERIMENT_CATALOG,
  type ExperimentStore,
  readRunner,
  runTick,
  type TickDeps,
  type TickResult,
} from "@/features/paper-engine";
import type { MarketApi } from "@/shared/api/binance/marketApi";

/** Binance отдаёт не больше 1000 свечей за запрос. */
const MAX_KLINES = 1000;

export interface EngineTickEnv {
  db: ExperimentDb;
  /** Роль этого процесса; тик работает, только если совпадает с engine_state.runner. */
  runner: EngineRunner;
  market: Pick<
    MarketApi,
    "fetchKlines" | "fetch24hTickers" | "fetchFundingRates"
  >;
  /** Символы бессрочных USDT-фьючерсов (с кэшем — createPerpetualsSource). */
  perpetuals: () => Promise<Set<string>>;
  /** Кэш свечей между тиками: на VM живёт в процессе, в Edge Function — на время экземпляра. */
  cache?: CandleCache;
  log?: TickDeps["log"];
  /**
   * Подготовка БД перед тиком своего раннера (сид каталога, первая эпоха) — внутри блокировки.
   * На VM не нужна: ensureEngineReady делает это при старте процесса.
   */
  prepare?: (tx: ExperimentDb) => Promise<void>;
}

/** Сид каталога (upsert по id) и первая эпоха — идемпотентно. */
export async function prepareEngineDb(db: ExperimentDb): Promise<void> {
  await seedExperiments(db, EXPERIMENT_CATALOG);
  await ensureRun(db);
}

/** Справочник бессрочных фьючерсов с TTL; сбой обновления — старая копия, если она есть. */
export function createPerpetualsSource(
  fetchSymbols: () => Promise<Set<string>>,
  ttlMs: number,
  clock: () => number,
): () => Promise<Set<string>> {
  let cached: { at: number; symbols: Set<string> } | null = null;
  return async () => {
    const now = clock();
    if (cached && now - cached.at < ttlMs) return cached.symbols;
    try {
      const symbols = await fetchSymbols();
      cached = { at: now, symbols };
      return symbols;
    } catch (error) {
      if (cached) return cached.symbols;
      throw error;
    }
  };
}

/** TickDeps движка поверх хранилища (Drizzle в транзакции блокировки) и публичных данных Binance. */
export function buildTickDeps(
  env: EngineTickEnv,
  store: ExperimentStore,
): TickDeps {
  return {
    runner: env.runner,
    store,
    candles: (market, symbol, interval, limit, startTime) =>
      env.market.fetchKlines(
        market,
        symbol,
        interval,
        Math.min(limit, MAX_KLINES),
        startTime,
      ),
    tickers: async (market) => {
      const list = await env.market.fetch24hTickers(market);
      if (market === "spot") return list;
      const perps = await env.perpetuals();
      return list.filter((t) => perps.has(t.symbol));
    },
    funding: () => env.market.fetchFundingRates(),
    cache: env.cache,
    log: env.log,
  };
}

const emptyResult = (
  status: TickResult["status"],
  runner: EngineRunner,
  now: number,
): TickResult => ({
  status,
  runner,
  at: new Date(now).toISOString(),
  opened: 0,
  closed: 0,
  evaluated: [],
  errors: [],
});

/**
 * Один тик под межпроцессной блокировкой (advisory lock в общей БД): занята — `locked`, ничего не
 * делаем. Тик чужого раннера (`engine_state.runner` ≠ env.runner) — `foreign-runner` без записей в БД,
 * даже без сида каталога. Тик — одна транзакция: упал посередине — в БД не остаётся половины тика.
 */
export async function runEngineTick(
  env: EngineTickEnv,
  now: number,
): Promise<TickResult> {
  const locked = await withEngineTickLock(env.db, async (tx) => {
    const store = createDbExperimentStore(tx);
    if ((await readRunner(store)) !== env.runner)
      return emptyResult("foreign-runner", env.runner, now);
    await env.prepare?.(tx);
    return runTick(buildTickDeps(env, store), now);
  });
  return locked.acquired
    ? locked.value
    : emptyResult("locked", env.runner, now);
}
