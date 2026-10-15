import {
  atrSeries,
  type Candle,
  computeEntryContext,
  type ExitReason,
  type Experiment,
  type ExperimentMarket,
  ema,
  entryFill,
  evaluateStrategy,
  exitFill,
  FEE_RATE,
  isFuturesMarket,
  type MarketFilter,
  marketRegimeAllows,
  type PaperTrade,
  regimeMinCandles,
  type SkippedSignal,
  type SkipReason,
  sessionAllows,
  settle,
  sizePosition,
  TIMEFRAME_MS,
  type Timeframe,
  type TradeDirection,
  walkExits,
  worseMae,
} from "@binance-dashboard/trading-core";
import { z } from "zod";
import { ENGINE } from "../config/engine.ts";
import {
  type CandleCache,
  candleKey,
  closedCandles,
  lastClosedOpenTime,
  mergeCandles,
  seededRandom,
} from "../lib/candles.ts";
import { computeLevels } from "../lib/levels.ts";
import { createLimiter } from "../lib/limiter.ts";
import {
  type MarketTicker,
  pickUniverse,
  symbolInMarket,
} from "../lib/universe.ts";
import {
  DEFAULT_RUNNER,
  ENGINE_KEYS,
  type EngineRunner,
  type ExperimentStore,
  RUNNERS,
  type SkippedSignalCount,
} from "./store.ts";

// Тик движка экспериментов. Среда-независимый: без @/…, node:*, process.env, fs и таймеров —
// его вызывают и in-process таймер на VM (instrumentation.ts), и Edge Function Supabase (Deno).

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type Interval = Timeframe | "1m";

/** Всё внешнее, что нужно тику: данные рынка, хранилище, роль раннера. */
export interface TickDeps {
  /** Этот раннер; тик работает, только если он совпадает с engine_state.runner. */
  runner: EngineRunner;
  store: ExperimentStore;
  /**
   * Публичные свечи Binance (последняя может быть незакрытой — движок её отбросит). Без startTime —
   * последние limit свечей, со startTime (мс) — до limit свечей начиная с него.
   */
  candles(
    market: ExperimentMarket,
    symbol: string,
    interval: Interval,
    limit: number,
    startTime?: number,
  ): Promise<Candle[]>;
  /**
   * Тикеры 24 ч рынка; для фьючерсов — только бессрочные контракты, у COIN-M — с размером
   * контракта и оборотом в $ (coinmTicker).
   */
  tickers(market: ExperimentMarket): Promise<MarketTicker[]>;
  /** Текущие ставки funding бессрочных фьючерсов группы (доля): { BTCUSDT: 0.0001 }. */
  funding(market: ExperimentMarket): Promise<Record<string, number>>;
  /** Кэш свечей между тиками (на VM — в памяти процесса). Нет — свечи грузятся заново. */
  cache?: CandleCache;
  log?: (
    level: "info" | "warn" | "error",
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
}

/** locked — тик не запускался: блокировку тика держит другой процесс (ставит композиция, не runTick). */
export type TickStatus = "ok" | "disabled" | "foreign-runner" | "locked";

export interface TickResult {
  status: TickStatus;
  runner: EngineRunner;
  /** Время тика, ISO. */
  at: string;
  opened: number;
  closed: number;
  /** Эксперименты, чья свеча TF закрылась в этом тике. */
  evaluated: string[];
  errors: string[];
}

const runnerSchema = z.enum(RUNNERS);
const barsSchema = z.record(z.string(), z.number());

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Роль раннера из engine_state; нет или мусор — раннер по умолчанию. */
export async function readRunner(store: ExperimentStore) {
  const parsed = runnerSchema.safeParse(
    await store.getState(ENGINE_KEYS.runner),
  );
  return parsed.success ? parsed.data : DEFAULT_RUNNER;
}

/** Тумблер движка из engine_state; по умолчанию выключен. */
export async function readEnabled(store: ExperimentStore) {
  return (await store.getState(ENGINE_KEYS.enabled)) === true;
}

/**
 * Один тик: проверка выходов открытых сделок по 1m-свечам, затем — для экспериментов, у
 * которых закрылась новая свеча TF, — выходы по сигналу и новые входы. Повтор тика в ту же
 * минуту ничего не дублирует: свеча TF обрабатывается один раз, id сделки детерминирован.
 */
export async function runTick(
  deps: TickDeps,
  now: number,
): Promise<TickResult> {
  const { store } = deps;
  const result: TickResult = {
    status: "ok",
    runner: deps.runner,
    at: new Date(now).toISOString(),
    opened: 0,
    closed: 0,
    evaluated: [],
    errors: [],
  };
  if ((await readRunner(store)) !== deps.runner)
    return { ...result, status: "foreign-runner" };
  if (!(await readEnabled(store))) return { ...result, status: "disabled" };

  const fail = (where: string, error: unknown) => {
    const message = `${where}: ${errorText(error)}`;
    result.errors.push(message);
    deps.log?.("warn", "engine.error", message);
  };

  const limit = createLimiter(ENGINE.concurrency);
  const cache: CandleCache = deps.cache ?? new Map();
  const experiments = await store.listExperiments(({ id, problem }) =>
    fail(`эксперимент ${id} пропущен: конфиг не проходит схему`, problem),
  );
  const byId = new Map(experiments.map((e) => [e.id, e]));
  const runId = await store.currentRunId();
  const open = await store.openTrades(runId);
  const realized = await store.realizedPnl(runId);

  // Тикеры и funding — один запрос на рынок за тик, общий для всех экспериментов.
  const tickerMemo = new Map<ExperimentMarket, Promise<MarketTicker[]>>();
  const tickers = (market: ExperimentMarket) => {
    let p = tickerMemo.get(market);
    if (!p) {
      p = limit(() => deps.tickers(market));
      tickerMemo.set(market, p);
    }
    return p;
  };
  const fundingMemo = new Map<
    ExperimentMarket,
    Promise<Record<string, number>>
  >();
  const funding = (market: ExperimentMarket) => {
    let p = fundingMemo.get(market);
    if (!p) {
      p = limit(() => deps.funding(market));
      fundingMemo.set(market, p);
    }
    return p;
  };

  // Свечи TF: один фетч на (market, symbol, tf) за тик, кэш между тиками дозагружает хвост.
  const candleMemo = new Map<string, Promise<Candle[]>>();
  const signalCandles = (
    market: ExperimentMarket,
    symbol: string,
    tf: Timeframe,
  ) => {
    const key = candleKey(market, symbol, tf);
    let p = candleMemo.get(key);
    if (!p) {
      p = (async () => {
        const tfMs = TIMEFRAME_MS[tf];
        const cached = cache.get(key) ?? [];
        const target = lastClosedOpenTime(tfMs, now);
        const last = cached.at(-1);
        if (last && last.openTime >= target)
          return cached.filter((c) => c.openTime <= target);
        const missing = last
          ? Math.ceil((target - last.openTime) / tfMs) + 1
          : Number.POSITIVE_INFINITY;
        const count =
          missing < ENGINE.refreshCandles
            ? ENGINE.refreshCandles
            : ENGINE.signalCandles;
        // +1 — последняя свеча обычно незакрытая и будет отброшена.
        const fresh = await limit(() =>
          deps.candles(market, symbol, tf, count + 1),
        );
        const base = count === ENGINE.signalCandles ? [] : cached;
        const merged = mergeCandles(
          base,
          closedCandles(fresh, tfMs, now),
          ENGINE.signalCandles,
        );
        cache.set(key, merged);
        return merged;
      })();
      candleMemo.set(key, p);
    }
    return p;
  };

  // Свечи режима рынка (spec 0029) — через signalCandles: общий кэш, один запрос на (рынок, символ, TF).
  // Сбой загрузки и короткая история — одна ошибка тика на (рынок, символ, TF), а не на каждый эксперимент.
  // Нет данных — вход запрещён (как у trendFilter); выходы идут как обычно.
  const regimeMemo = new Map<string, Promise<Candle[] | null>>();
  const regimeReported = new Set<string>();
  const regimeAllows = async (
    market: ExperimentMarket,
    filter: MarketFilter,
    direction: TradeDirection,
  ) => {
    // Символ режима — в формате группы: BTCUSDT у COIN-M — BTCUSD_PERP (свечи dapi).
    const symbol = symbolInMarket(filter.symbol, market);
    const key = candleKey(market, symbol, filter.timeframe);
    const where = `режим рынка ${market} ${symbol} ${filter.timeframe}`;
    let p = regimeMemo.get(key);
    if (!p) {
      p = signalCandles(market, symbol, filter.timeframe).catch((error) => {
        fail(where, error);
        return null;
      });
      regimeMemo.set(key, p);
    }
    const candles = await p;
    if (candles === null) return false;
    const need = regimeMinCandles(filter);
    if (candles.length < need) {
      if (!regimeReported.has(`${key}:${need}`)) {
        regimeReported.add(`${key}:${need}`);
        fail(where, `мало свечей режима: ${candles.length} из ${need}`);
      }
      return false;
    }
    return marketRegimeAllows(candles, filter, direction);
  };

  // Контекст входа (spec 0030): свечи BTC 4h группы (BTCUSDT; у COIN-M — BTCUSD_PERP) — через signalCandles (общий
  // кэш со свечами режима 0029), funding — общий запрос тика по группе фьючерсов. Грузятся, только когда сделка
  // открывается; сбой — поля контекста null, вход не страдает.
  const contextBtcMemo = new Map<ExperimentMarket, Promise<Candle[] | null>>();
  const contextBtcCandles = (market: ExperimentMarket) => {
    let p = contextBtcMemo.get(market);
    if (!p) {
      p = signalCandles(
        market,
        symbolInMarket(ENGINE.contextBtcSymbol, market),
        "4h",
      ).catch(() => null);
      contextBtcMemo.set(market, p);
    }
    return p;
  };
  const contextFunding = (market: ExperimentMarket) =>
    funding(market).catch((): Record<string, number> => ({}));

  // Отсечённые сигналы тика (spec 0030) — пишутся одной пачкой в конце тика.
  const skipped: SkippedSignal[] = [];
  // Сбой свечей фильтра тренда — одна ошибка тика на (рынок, символ, TF).
  const trendReported = new Set<string>();

  const closeTrade = async (
    trade: PaperTrade,
    rawPrice: number,
    reason: ExitReason,
    at: number,
    // Худшая цена с входа: проход выходов считает её сам (со свечой выхода), прочие выходы — по цене выхода.
    mae = worseMae(trade.direction, trade.mae, rawPrice),
  ) => {
    const exitPrice = exitFill(rawPrice, trade.direction, reason);
    const s = settle({
      market: trade.market,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice,
      quantity: trade.quantity,
      initialStop: trade.initialStop,
    });
    await store.closeTrade(trade.id, {
      closedAt: new Date(at).toISOString(),
      exitPrice,
      exitReason: reason,
      fees: s.fees,
      pnl: s.pnl,
      rMultiple: s.rMultiple,
      mae,
    });
    realized[trade.experimentId] = (realized[trade.experimentId] ?? 0) + s.pnl;
    open.splice(open.indexOf(trade), 1);
    result.closed++;
    deps.log?.(
      "info",
      "engine.close",
      `${trade.experimentId} ${trade.symbol}`,
      {
        id: trade.id,
        reason,
        pnl: s.pnl,
      },
    );
  };

  /**
   * Закрытые 1m-свечи от from подряд: страницы по maxMinuteCandles от startTime, пока не дойдём до
   * текущей минуты. Разрыв короче страницы — один запрос. После долгого простоя — не больше
   * maxMinutePages страниц за тик: checkedUntil сдвинется только по прочитанному, остальное
   * дочитают следующие тики (баг 0028: раньше читался только хвост, пропущенные минуты терялись).
   */
  const minuteCandles = async (
    market: ExperimentMarket,
    symbol: string,
    from: number,
  ) => {
    const minutes: Candle[] = [];
    let start = from;
    for (let page = 0; page < ENGINE.maxMinutePages; page++) {
      const left = Math.max(2, Math.ceil((now - start) / MINUTE) + 1);
      const batch = closedCandles(
        await limit(() =>
          deps.candles(
            market,
            symbol,
            "1m",
            Math.min(ENGINE.maxMinuteCandles, left),
            start,
          ),
        ),
        MINUTE,
        now,
      ).filter((c) => c.openTime >= start);
      minutes.push(...batch);
      const last = batch.at(-1);
      if (!last || left <= ENGINE.maxMinuteCandles) return minutes;
      start = last.openTime + MINUTE;
    }
    const end = lastClosedOpenTime(MINUTE, now) + MINUTE;
    if (start < end) {
      const gapMinutes = Math.round((end - from) / MINUTE);
      const leftMinutes = Math.round((end - start) / MINUTE);
      deps.log?.(
        "warn",
        "engine.minute-gap",
        `${market} ${symbol}: разрыв 1m-свечей выходов ${gapMinutes} мин, за тик прочитано ${minutes.length}, остаток ${leftMinutes} мин дочитают следующие тики`,
        { market, symbol, gapMinutes, leftMinutes },
      );
    }
    return minutes;
  };

  // 1. Выходы по 1m-свечам после checkedUntil: стоп, тейк, трейлинг, безубыток, тайм-стоп.
  const groups = new Map<string, PaperTrade[]>();
  for (const t of open) {
    const key = `${t.market}:${t.symbol}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  await Promise.all(
    [...groups.values()].map(async (trades) => {
      const { market, symbol } = trades[0];
      try {
        const from = Math.min(...trades.map((t) => t.checkedUntil));
        const minutes = await minuteCandles(market, symbol, from);
        for (const trade of trades) {
          const exp = byId.get(trade.experimentId);
          if (!exp) continue;
          const walk = walkExits(
            { ...trade, openedAt: Date.parse(trade.openedAt) },
            minutes,
            {
              trailAtr: exp.config.exit.trailAtr,
              breakevenAtR: exp.config.exit.breakevenAtR,
              timeStopBars: exp.config.exit.timeStopBars,
              timeframeMs: TIMEFRAME_MS[exp.config.timeframe],
            },
          );
          if (walk.exit) {
            await closeTrade(
              trade,
              walk.exit.price,
              walk.exit.reason,
              walk.exit.at,
              walk.mae,
            );
          } else if (
            walk.stop !== trade.stop ||
            walk.extreme !== trade.extreme ||
            walk.mae !== trade.mae ||
            walk.checkedUntil !== trade.checkedUntil
          ) {
            const progress = {
              stop: walk.stop,
              extreme: walk.extreme,
              mae: walk.mae,
              checkedUntil: walk.checkedUntil,
            };
            await store.updateTrade(trade.id, progress);
            Object.assign(trade, progress);
          }
        }
      } catch (error) {
        fail(`выходы ${market} ${symbol}`, error);
      }
    }),
  );

  // 2. Сигналы на закрытии свечи TF эксперимента.
  const barsParsed = barsSchema.safeParse(
    await store.getState(ENGINE_KEYS.bars),
  );
  const bars = barsParsed.success ? barsParsed.data : {};

  // Рынок без тикеров (биржа недоступна, например dapi для COIN-M): одна запись в журнал за тик,
  // его эксперименты ждут следующего тика, остальные группы торгуют.
  const downMarkets = new Set<ExperimentMarket>();
  const marketTickers = async (market: ExperimentMarket) => {
    if (downMarkets.has(market)) return null;
    try {
      return await tickers(market);
    } catch (error) {
      downMarkets.add(market);
      fail(`тикеры ${market}: рынок пропущен`, error);
      return null;
    }
  };

  for (const exp of experiments) {
    if (!exp.enabled) continue;
    const { config } = exp;
    const tfMs = TIMEFRAME_MS[config.timeframe];
    const bar = lastClosedOpenTime(tfMs, now);
    const seen = (bars[exp.id] ?? Number.NEGATIVE_INFINITY) >= bar;
    // hold (S20, F20) — «всегда в позиции»: пока позиции нет, пробуем войти каждый тик.
    const holdGap =
      config.entry.type === "hold" &&
      open.filter((t) => t.experimentId === exp.id).length < config.maxOpen;
    if (seen && !holdGap) continue;
    const list = await marketTickers(exp.market);
    if (!list) continue;
    try {
      await evaluateExperiment(exp, bar, list);
      if (!seen) {
        bars[exp.id] = bar;
        result.evaluated.push(exp.id);
      }
    } catch (error) {
      // Свеча не помечена обработанной — следующий тик попробует снова.
      fail(`эксперимент ${exp.id}`, error);
    }
  }
  if (result.evaluated.length > 0) await store.setState(ENGINE_KEYS.bars, bars);

  async function evaluateExperiment(
    exp: Experiment,
    bar: number,
    list: MarketTicker[],
  ) {
    const { config, market } = exp;
    const ticker = new Map(list.map((t) => [t.symbol, t]));
    const universe = pickUniverse(config.universe, list, market);
    const mine = () => open.filter((t) => t.experimentId === exp.id);
    const symbols = [...new Set([...universe, ...mine().map((t) => t.symbol)])];

    const loaded = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const candles = await signalCandles(market, symbol, config.timeframe);
          // Свеча этого бара ещё не пришла от Binance — символ пропускаем.
          return candles.at(-1)?.openTime === bar ? { symbol, candles } : null;
        } catch (error) {
          fail(`свечи ${market} ${symbol} ${config.timeframe}`, error);
          return null;
        }
      }),
    );
    const ready = loaded.filter((x) => x !== null);
    const rates =
      isFuturesMarket(market) && config.entry.type === "funding"
        ? await funding(market)
        : {};
    const ranks = momentumRanks(exp, ready, universe);
    const inUniverse = new Set(universe);
    // Место в юниверсе по обороту за 24 ч (1 — самый ликвидный) — для контекста входа.
    const volumeRank = new Map(
      [...universe]
        .sort(
          (a, b) =>
            (ticker.get(b)?.quoteVolume ?? 0) -
            (ticker.get(a)?.quoteVolume ?? 0),
        )
        .map((symbol, i) => [symbol, i + 1]),
    );
    // Свеча закрылась давно (первый тик после включения, рестарт, простой) — по такому сигналу не
    // входим: цена уже ушла. Выходы по сигналу оставляем — они закрывают риск.
    const tfMs = TIMEFRAME_MS[config.timeframe];
    const maxAge = Math.max(
      ENGINE.minSignalAgeMs,
      ENGINE.signalAgeShare * tfMs,
    );
    const hold = config.entry.type === "hold";
    const fresh = hold || now - (bar + tfMs) <= maxAge;
    // Торговые часы — по времени входа (тика), одно решение на эксперимент.
    const inSession =
      !config.sessionFilter || sessionAllows(now, config.sessionFilter);

    for (const { symbol, candles } of ready) {
      const t = ticker.get(symbol);
      const signal = evaluateStrategy(config.entry, {
        candles,
        change24h: (t?.priceChangePercent ?? 0) / 100,
        funding: rates[symbol],
        momentumRank: ranks.get(symbol),
        random: seededRandom(`${exp.id}:${symbol}:${bar}`),
      });
      const price = t?.lastPrice ?? candles[candles.length - 1].close;

      if (config.exit.exitOnSignal)
        for (const trade of mine().filter((x) => x.symbol === symbol))
          if (signal.exit[trade.direction])
            await closeTrade(trade, price, "signal", now);

      const entry = signal.entry;
      if (!entry || !fresh || !inUniverse.has(symbol)) continue;
      if (!allowed(exp, entry.direction) || !inSession) continue;
      const current = mine();
      // Лимит позиций проверяется после фильтров режима и тренда: отсечённый сигнал (spec 0030) — тот, что
      // прошёл все фильтры эксперимента и не открыт только из-за лимита. Для открытых сделок порядок не важен.
      const full: SkipReason | null =
        current.length >= config.maxOpen
          ? "max-open"
          : current.some((x) => x.symbol === symbol)
            ? "symbol-busy"
            : null;
      if (
        config.marketFilter &&
        !(await regimeAllows(market, config.marketFilter, entry.direction))
      )
        continue;
      if (!(await trendAllows(exp, symbol, entry.direction, price))) continue;

      const atr = atrSeries(candles, ENGINE.atrPeriod).at(-1) ?? Number.NaN;
      const fill = entryFill(price, entry.direction);
      const levels = computeLevels(
        config.exit,
        entry,
        entry.direction,
        fill,
        atr,
      );
      if (!levels) continue;
      const skip = (reason: SkipReason) => {
        // hold «всегда в позиции»: занятый символ и лимит — его норма, а не упущенный сигнал.
        if (hold) return;
        skipped.push({
          id: `${runId}-${exp.id}-${symbol}-${bar}-${reason}`,
          runId,
          experimentId: exp.id,
          market,
          symbol,
          direction: entry.direction,
          bar,
          at: new Date(now).toISOString(),
          reason,
          entryPrice: fill,
          stop: levels.stop,
          takeProfit: levels.takeProfit,
        });
      };
      if (full) {
        skip(full);
        continue;
      }
      const leverage = isFuturesMarket(market) ? ENGINE.futuresLeverage : 1;
      // COIN-M — целые контракты: без размера контракта объём не посчитать.
      const contractSizeUsd = market === "coinm" ? t?.contractSize : undefined;
      if (market === "coinm" && contractSizeUsd === undefined) continue;
      const used = current.reduce(
        (s, x) => s + (x.entryPrice * x.quantity) / leverage,
        0,
      );
      const size = sizePosition({
        entry: fill,
        stop: levels.stop,
        initialBudget: exp.initialBudget,
        availableUsd: exp.initialBudget + (realized[exp.id] ?? 0) - used,
        leverage,
        fixedNotionalUsd: ENGINE.tradeNotionalUsd,
        contractSizeUsd,
      });
      if (!size) {
        skip("no-budget");
        continue;
      }

      const trade: PaperTrade = {
        // hold входит и посреди свечи (после закрытия позиции) — id по минуте, а не по свече.
        id: `${runId}-${exp.id}-${symbol}-${hold ? Math.floor(now / MINUTE) * MINUTE : bar}`,
        runId,
        experimentId: exp.id,
        market,
        symbol,
        direction: entry.direction,
        openedAt: new Date(now).toISOString(),
        entryPrice: fill,
        quantity: size.quantity,
        initialStop: levels.stop,
        stop: levels.stop,
        takeProfit: levels.takeProfit,
        atr: Number.isFinite(atr) ? atr : 0,
        extreme: fill,
        mae: fill,
        // Выходы — со следующей минуты: в текущей 1m-свече есть цены до входа.
        checkedUntil: Math.floor(now / MINUTE) * MINUTE + MINUTE,
        closedAt: null,
        exitPrice: null,
        exitReason: null,
        fees: FEE_RATE[market] * size.notional,
        pnl: null,
        rMultiple: null,
        demoOrderRef: null,
        signal: { ...entry.meta, bar, price, timeframe: config.timeframe },
        entryContext: computeEntryContext({
          at: now,
          timeframe: config.timeframe,
          candles,
          btc4h: await contextBtcCandles(market),
          funding: isFuturesMarket(market)
            ? ((await contextFunding(market))[symbol] ?? null)
            : null,
          universeRank: volumeRank.get(symbol) ?? null,
          universeSize: universe.length,
        }),
      };
      await store.insertTrade(trade);
      open.push(trade);
      result.opened++;
      deps.log?.(
        "info",
        "engine.open",
        `${exp.id} ${symbol} ${entry.direction}`,
        {
          id: trade.id,
          price: fill,
          qty: size.quantity,
        },
      );
    }
  }

  /**
   * Фильтр тренда старшего TF: long — цена выше EMA(period), short — ниже. Сбой загрузки свечей — вход запрещён,
   * одна ошибка тика на (рынок, символ, TF), как у режима рынка: остальные символы эксперимента (их выходы по
   * сигналу и входы) обрабатываются дальше.
   */
  async function trendAllows(
    exp: Experiment,
    symbol: string,
    direction: TradeDirection,
    price: number,
  ) {
    const filter = exp.config.trendFilter;
    if (!filter) return true;
    let candles: Candle[];
    try {
      candles = await signalCandles(exp.market, symbol, filter.timeframe);
    } catch (error) {
      const key = candleKey(exp.market, symbol, filter.timeframe);
      if (!trendReported.has(key)) {
        trendReported.add(key);
        fail(`тренд ${exp.market} ${symbol} ${filter.timeframe}`, error);
      }
      return false;
    }
    const level = ema(
      candles.map((c) => c.close),
      filter.period,
    ).at(-1);
    if (level === undefined || !Number.isFinite(level)) return false;
    return direction === "long" ? price > level : price < level;
  }

  // Отсечённые сигналы: не больше skippedSignalsCap на (эпоха, эксперимент, причина), старше срока хранения —
  // удаляются. Объём базы ограничен (Supabase Free), для разбора хватает выборки.
  if (skipped.length > 0)
    try {
      const counts = await store.skippedSignalCounts(runId, [
        ...new Set(skipped.map((s) => s.experimentId)),
      ]);
      await store.insertSkippedSignals(
        capSkipped(skipped, counts, ENGINE.skippedSignalsCap),
      );
      await store.pruneSkippedSignals(
        new Date(now - ENGINE.skippedSignalsRetentionDays * DAY).toISOString(),
      );
    } catch (error) {
      fail("отсечённые сигналы", error);
    }

  await store.setState(ENGINE_KEYS.lastTick, result);
  return result;
}

/**
 * Отсечённые сигналы в пределах лимита: на (эксперимент, причина) — не больше cap вместе с уже записанными
 * в эпохе. Порядок сохраняется: в лимит попадают первые сигналы тика.
 */
export function capSkipped(
  rows: SkippedSignal[],
  counts: SkippedSignalCount[],
  cap: number,
): SkippedSignal[] {
  const used = new Map(
    counts.map((c) => [`${c.experimentId}:${c.reason}`, c.count]),
  );
  return rows.filter((r) => {
    const key = `${r.experimentId}:${r.reason}`;
    const n = used.get(key) ?? 0;
    if (n >= cap) return false;
    used.set(key, n + 1);
    return true;
  });
}

/** Spot — только long, фьючерсы (USDⓈ-M, COIN-M) — оба; плюс направления из конфига эксперимента. */
const allowed = (exp: Experiment, direction: TradeDirection) =>
  exp.config.directions.includes(direction) &&
  (isFuturesMarket(exp.market) || direction === "long");

/** Место символа по доходности за lookback среди юниверса (0 — лучший); только для momentum. */
function momentumRanks(
  exp: Experiment,
  ready: { symbol: string; candles: Candle[] }[],
  universe: string[],
): Map<string, number> {
  const entry = exp.config.entry;
  if (entry.type !== "momentum") return new Map();
  const inUniverse = new Set(universe);
  const returns = ready
    .filter((r) => inUniverse.has(r.symbol))
    .flatMap(({ symbol, candles }) => {
      const lastClose = candles.at(-1)?.close;
      const base = candles.at(-1 - entry.lookbackBars)?.close;
      return lastClose && base ? [{ symbol, ret: lastClose / base - 1 }] : [];
    })
    .sort((a, b) => b.ret - a.ret);
  const ranks = new Map(returns.map((r, i) => [r.symbol, i]));
  // Символ с открытой позицией выпал из юниверса или без данных — считается выбывшим.
  for (const r of ready)
    if (!ranks.has(r.symbol)) ranks.set(r.symbol, universe.length);
  return ranks;
}
