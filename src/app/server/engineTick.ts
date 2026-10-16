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
  coinmTicker,
  type EngineRunner,
  EXPERIMENT_CATALOG,
  type ExperimentStore,
  readRunner,
  runTick,
  type TickDeps,
  type TickResult,
} from "@/features/paper-engine";
import type {
  FuturesMarket,
  MarketApi,
  Perpetuals,
} from "@/shared/api/binance/marketApi";

/** Binance отдаёт не больше 1000 свечей за запрос. */
const MAX_KLINES = 1000;

export interface EngineTickEnv {
  db: ExperimentDb;
  /** Роль этого процесса; тик работает, только если совпадает с engine_state.runner. */
  runner: EngineRunner;
  market: Pick<
    MarketApi,
    | "fetchKlines"
    | "fetch24hTickers"
    | "fetchCoinmTickers"
    | "fetchFundingRates"
  >;
  /**
   * Бессрочные контракты USDⓈ-M и COIN-M в торговле (символ → размер контракта COIN-M), с кэшем —
   * createPerpetualsSources.
   */
  perpetuals: (market: FuturesMarket) => Promise<Perpetuals>;
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
export function createPerpetualsSource<T>(
  fetchSymbols: () => Promise<T>,
  ttlMs: number,
  clock: () => number,
): () => Promise<T> {
  let cached: { at: number; symbols: T } | null = null;
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

/** Справочники бессрочных контрактов USDⓈ-M и COIN-M — у каждого рынка свой кэш с TTL. */
export function createPerpetualsSources(
  fetchPerpetuals: (market: FuturesMarket) => Promise<Perpetuals>,
  ttlMs: number,
  clock: () => number,
): (market: FuturesMarket) => Promise<Perpetuals> {
  const sources: Record<FuturesMarket, () => Promise<Perpetuals>> = {
    usdm: createPerpetualsSource(() => fetchPerpetuals("usdm"), ttlMs, clock),
    coinm: createPerpetualsSource(() => fetchPerpetuals("coinm"), ttlMs, clock),
  };
  return (market) => sources[market]();
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
      if (market === "spot") return env.market.fetch24hTickers("spot");
      const perps = await env.perpetuals(market);
      // Справочник только крипты пуст (Binance сменил underlyingType?) — юниверс группы пуст молча (spec 0029).
      if (perps.size === 0)
        env.log?.(
          "warn",
          "engine.perpetuals",
          `справочник бессрочных ${market} пуст после фильтра только крипты: эксперименты группы без юниверса`,
        );
      if (market === "usdm")
        return (await env.market.fetch24hTickers("usdm")).filter((t) =>
          perps.has(t.symbol),
        );
      // COIN-M: оборот в $ и размер сделки — по размеру контракта из exchangeInfo.
      return (await env.market.fetchCoinmTickers()).flatMap((t) => {
        const size = perps.get(t.symbol);
        return size ? [coinmTicker(t, size)] : [];
      });
    },
    funding: async (market) =>
      market === "spot" ? {} : env.market.fetchFundingRates(market),
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
