// Бэктест экспериментов лаборатории по истории свечей Binance (spec 0032, `pnpm lab:backtest`). Своей торговой
// логики нет: прогон — это тот же `runTick` движка (features/paper-engine) с хранилищем в памяти и историческими
// TickDeps, по шагу закрытия свечи ТФ. Заглядывания вперёд нет по построению: зависимости тика отдают только то, что
// было известно к его моменту `now` (свечи, закрытые к now; оборот 24 ч по закрытым часам; выплаченный funding).
// Метрики и отчёт — те же buildLabReport/renderLabReport, что у `pnpm lab:report`.
import {
  type Candle,
  type Experiment,
  type ExperimentMarket,
  isFuturesMarket,
  MAJOR_BASES,
  MARKETS,
  type PaperTrade,
  type SkippedSignal,
  TIMEFRAME_MS,
  type Timeframe,
  type Universe,
} from "@binance-dashboard/trading-core";
import {
  createMemoryStore,
  DEFAULT_RUNNER,
  ENGINE,
  ENGINE_KEYS,
  type ExperimentStore,
  type Interval,
  type MarketTicker,
  pickUniverse,
  runTick,
  type TickDeps,
} from "@/features/paper-engine";
import {
  type BacktestHistory,
  type FundingPoint,
  type HistoryCandle,
  type HistoryStats,
  INTERVAL_MS,
  type MarketSymbol,
} from "./labHistory";
import { type KlineSet, klineKey } from "./labKlines";
import { computeMarketContext, type MarketContext } from "./labMarket";
import {
  buildLabReport,
  type ExperimentReport,
  type LabDataset,
  type LabReport,
  renderLabReport,
} from "./labReport";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const H4 = TIMEFRAME_MS["4h"];

/** Интервал свечей, по которым проверяются выходы (живой движок — 1m). */
export const EXIT_INTERVALS = ["1m", "5m", "15m"] as const;
export type ExitInterval = (typeof EXIT_INTERVALS)[number];

/** Порог точных выходов (spec 0032, AC3): 1m — период ≤ 30 дней и юниверс ≤ 10 символов; иначе 5m. */
export const EXACT_EXITS = { maxDays: 30, maxSymbols: 10 } as const;

/** Свечей прогрева до начала периода: столько же, сколько хранит движок (EMA/SMA 200 с запасом). */
const WARMUP_BARS = ENGINE.signalCandles + 2;

// --- Ряды свечей в памяти ---

/** Свечи одного (рынок, символ, интервал) колонками: бэктест на 120 дней держит миллионы свечей. */
export interface Series {
  /** С какого openTime ряд загружен. */
  from: number;
  openTime: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  /** Префиксные суммы оборота: cumQuote[i] = Σ quoteVolume[0..i). */
  cumQuote: Float64Array;
}

export function toSeries(from: number, candles: HistoryCandle[]): Series {
  const n = candles.length;
  const s: Series = {
    from,
    openTime: new Float64Array(n),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    volume: new Float64Array(n),
    cumQuote: new Float64Array(n + 1),
  };
  candles.forEach((c, i) => {
    s.openTime[i] = c.openTime;
    s.open[i] = c.open;
    s.high[i] = c.high;
    s.low[i] = c.low;
    s.close[i] = c.close;
    s.volume[i] = c.volume;
    s.cumQuote[i + 1] = s.cumQuote[i] + c.quoteVolume;
  });
  return s;
}

/** Первый индекс с arr[i] ≥ value. */
export function lowerBound(arr: Float64Array, value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const candleAt = (s: Series, i: number, shift = 0): Candle => ({
  openTime: s.openTime[i] + shift,
  open: s.open[i],
  high: s.high[i],
  low: s.low[i],
  close: s.close[i],
  volume: s.volume[i],
});

/** Индекс последней свечи, закрытой к now (openTime + ms ≤ now); −1 — такой нет. */
const lastClosedIndex = (s: Series, ms: number, now: number) =>
  lowerBound(s.openTime, now - ms + 1) - 1;

/**
 * Ряды по требованию: первый запрос грузит [from, end) из истории (диск/Binance), запрос раньше загруженного —
 * догружает ряд целиком с нового начала. Неудачная загрузка запоминается: данные не появятся посреди прогона.
 */
export function createSeriesStore(history: BacktestHistory, end: number) {
  const map = new Map<string, { from: number; promise: Promise<Series> }>();
  return {
    get(
      market: ExperimentMarket,
      symbol: string,
      interval: Interval,
      from: number,
    ): Promise<Series> {
      const key = `${market}:${symbol}:${interval}`;
      const entry = map.get(key);
      if (entry && entry.from <= from) return entry.promise;
      const loadFrom = Math.min(from, entry?.from ?? from);
      // Нужны только свечи, закрытые к концу периода: openTime + ms ≤ end.
      const ms = INTERVAL_MS[interval];
      const promise = history
        .klines(market, symbol, interval, loadFrom, Math.floor(end / ms) * ms)
        .then((candles) => toSeries(loadFrom, candles));
      map.set(key, { from: loadFrom, promise });
      return promise;
    },
  };
}

export type SeriesStore = ReturnType<typeof createSeriesStore>;

// --- Период, шаг, точность выходов ---

/** Шаг тика — самый короткий ТФ экспериментов: на нём закрываются свечи всех остальных. */
export function stepOf(experiments: Experiment[]): Timeframe {
  const tfs = experiments.map((e) => e.config.timeframe);
  if (!tfs.length) throw new Error("нет экспериментов");
  return tfs.reduce((a, b) => (TIMEFRAME_MS[b] < TIMEFRAME_MS[a] ? b : a));
}

/** Моменты тиков: закрытия свечей шага от start до end включительно (start и end кратны шагу). */
export function tickTimes(
  start: number,
  end: number,
  stepMs: number,
): number[] {
  const out: number[] = [];
  for (let t = start; t <= end; t += stepMs) out.push(t);
  return out;
}

/** Сколько символов в юниверсе: majors — 5, symbols — список, top — N, movers — N роста + N падения. */
export function universeSize(u: Universe): number {
  switch (u.type) {
    case "majors":
      return MAJOR_BASES.length;
    case "symbols":
      return u.symbols?.length ?? 0;
    case "top":
      return u.n ?? 20;
    case "movers":
      return 2 * (u.n ?? 20);
  }
}

/** Точность выходов по умолчанию (AC3): 1m для короткого периода и малого юниверса, иначе 5m. */
export function chooseExitInterval(
  days: number,
  experiments: Experiment[],
): ExitInterval {
  const symbols = Math.max(
    0,
    ...experiments.map((e) => universeSize(e.config.universe)),
  );
  return days <= EXACT_EXITS.maxDays && symbols <= EXACT_EXITS.maxSymbols
    ? "1m"
    : "5m";
}

// --- Исторические зависимости тика ---

/**
 * Тикеры 24 ч на момент now по часовым свечам: окно — 24 закрытых часа до последнего полного часа. Символа без
 * свечей в окне тогда не было (ещё не листинг) — его нет и в тикерах. COIN-M: оборот в $ = контракты × размер.
 */
export function tickerAt(
  s: MarketSymbol,
  hourly: Series,
  now: number,
): MarketTicker | null {
  const hour = Math.floor(now / HOUR) * HOUR;
  const i0 = lowerBound(hourly.openTime, hour - DAY);
  const i1 = lowerBound(hourly.openTime, hour);
  if (i1 <= i0) return null;
  const turnover = hourly.cumQuote[i1] - hourly.cumQuote[i0];
  const lastPrice = hourly.close[i1 - 1];
  return {
    symbol: s.symbol,
    lastPrice,
    priceChangePercent: (lastPrice / hourly.open[i0] - 1) * 100,
    quoteVolume:
      s.contractSize === undefined ? turnover : turnover * s.contractSize,
    ...(s.contractSize === undefined ? {} : { contractSize: s.contractSize }),
  };
}

/** Последняя выплата funding не позже now; null — выплат ещё не было. */
export function fundingAt(points: FundingPoint[], now: number): number | null {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= now) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? points[lo - 1].rate : null;
}

export interface BacktestParams {
  experiments: Experiment[];
  /** Первый и последний тик, мс (кратны шагу). */
  start: number;
  end: number;
  exitInterval: ExitInterval;
  history: BacktestHistory;
  /** После каждого тика: номер, всего, время тика, сделок. */
  onTick?: (done: number, total: number, now: number, trades: number) => void;
}

export interface BacktestRun {
  trades: PaperTrade[];
  skipped: SkippedSignal[];
  step: Timeframe;
  ticks: number;
  /** Ошибки тиков, одинаковые сообщения — вместе (сбои данных: нет свечей, нет в кэше). */
  errors: { message: string; count: number }[];
  /** Символы, по которым нет истории funding (ставка не известна). */
  fundingMissing: string[];
  /** Снимки списков торгуемых символов по группам. */
  symbols: Partial<
    Record<ExperimentMarket, { count: number; snapshotAt: number }>
  >;
  series: SeriesStore;
}

/** Часы тика: зависимости читают его на каждом вызове. */
interface TickClock {
  now: number;
}

/**
 * Хранилище бэктеста: память движка, тумблер включён, роль — раннер по умолчанию. Лимит записи отсечённых сигналов
 * и срок их хранения — защита объёма прод-БД, в бэктесте они исказили бы разбор, поэтому выключены.
 */
export function backtestStore(experiments: Experiment[]): ExperimentStore & {
  trades(): PaperTrade[];
  skipped(): SkippedSignal[];
} {
  const base = createMemoryStore(
    experiments.map((e) => ({ ...e, enabled: true })),
    { [ENGINE_KEYS.enabled]: true, [ENGINE_KEYS.runner]: DEFAULT_RUNNER },
  );
  return {
    ...base,
    skippedSignalCounts: async () => [],
    pruneSkippedSignals: async () => {},
  };
}

interface DepsContext {
  experiments: Experiment[];
  start: number;
  end: number;
  exitInterval: ExitInterval;
  history: BacktestHistory;
  series: SeriesStore;
  store: ExperimentStore;
  clock: TickClock;
  /** Сбой данных вне тика (тикеры одного символа, funding) — в общий счёт ошибок. */
  note: (message: string) => void;
  fundingMissing: Set<string>;
  symbols: BacktestRun["symbols"];
}

/**
 * TickDeps по истории. candles: только свечи, закрытые к now (последняя незакрытая не отдаётся вовсе); «1m» —
 * свечи интервала выходов: если он крупнее минуты, свеча [S, S+X) отдаётся с openTime последней минуты S+X−1m —
 * движок считает её закрытой ровно в S+X и проверяет со свечи входа (вход — в момент тика, на границе свечи).
 * tickers: оборот и изменение за 24 ч по закрытым часам; цена — close часа, внутри часа — close свечи шага.
 * funding: последняя выплаченная к now ставка.
 */
export function createBacktestDeps(ctx: DepsContext): TickDeps {
  const { series, clock } = ctx;
  const stepByMarket = new Map<ExperimentMarket, Timeframe>();
  for (const m of MARKETS) {
    const own = ctx.experiments.filter((e) => e.market === m);
    if (own.length) stepByMarket.set(m, stepOf(own));
  }

  // Кандидаты в юниверс группы: все торгуемые сейчас для top/movers, иначе — только названные символы.
  const candidateMemo = new Map<ExperimentMarket, Promise<MarketSymbol[]>>();
  const candidates = (market: ExperimentMarket) => {
    let p = candidateMemo.get(market);
    if (!p) {
      p = (async () => {
        const { symbols, snapshotAt } = await ctx.history.symbols(market);
        ctx.symbols[market] = { count: symbols.length, snapshotAt };
        const own = ctx.experiments.filter((e) => e.market === market);
        if (own.some((e) => ["top", "movers"].includes(e.config.universe.type)))
          return symbols;
        const stub: MarketTicker[] = symbols.map((s) => ({
          symbol: s.symbol,
          lastPrice: 1,
          priceChangePercent: 0,
          quoteVolume: 0,
        }));
        const named = new Set(
          own.flatMap((e) => pickUniverse(e.config.universe, stub, market)),
        );
        return symbols.filter((s) => named.has(s.symbol));
      })();
      candidateMemo.set(market, p);
    }
    return p;
  };

  // Мемо на тик: тикеры и «нужные символы» (юниверсы экспериментов группы + открытые сделки).
  let memoAt = Number.NaN;
  const tickerMemo = new Map<ExperimentMarket, Promise<MarketTicker[]>>();
  const relevantMemo = new Map<ExperimentMarket, Promise<string[]>>();
  const memo = () => {
    if (memoAt !== clock.now) {
      memoAt = clock.now;
      tickerMemo.clear();
      relevantMemo.clear();
    }
  };

  const relevant = (market: ExperimentMarket, list: MarketTicker[]) => {
    memo();
    let p = relevantMemo.get(market);
    if (!p) {
      p = (async () => {
        const out = new Set<string>();
        for (const e of ctx.experiments)
          if (e.market === market)
            for (const s of pickUniverse(e.config.universe, list, market))
              out.add(s);
        const runId = await ctx.store.currentRunId();
        for (const t of await ctx.store.openTrades(runId))
          if (t.market === market) out.add(t.symbol);
        return [...out];
      })();
      relevantMemo.set(market, p);
    }
    return p;
  };

  const tickers = (market: ExperimentMarket): Promise<MarketTicker[]> => {
    memo();
    let p = tickerMemo.get(market);
    if (!p) {
      const now = clock.now;
      p = (async () => {
        const hour = Math.floor(now / HOUR) * HOUR;
        const rows = await Promise.all(
          (await candidates(market)).map(async (s) => {
            try {
              return tickerAt(
                s,
                await series.get(market, s.symbol, "1h", hour - DAY),
                now,
              );
            } catch (error) {
              ctx.note(`тикер ${market} ${s.symbol}: ${errorText(error)}`);
              return null;
            }
          }),
        );
        const list = rows.filter((t) => t !== null);
        // Внутри часа close часа устарел: цену нужных символов берём с закрытой к now свечи шага группы.
        const step = stepByMarket.get(market);
        if (step && TIMEFRAME_MS[step] < HOUR && now % HOUR !== 0) {
          const ms = TIMEFRAME_MS[step];
          const byName = new Map(list.map((t) => [t.symbol, t]));
          for (const symbol of await relevant(market, list)) {
            const t = byName.get(symbol);
            if (!t) continue;
            try {
              const s = await series.get(market, symbol, step, now - 2 * ms);
              const i = lastClosedIndex(s, ms, now);
              if (i >= 0) t.lastPrice = s.close[i];
            } catch (error) {
              ctx.note(`цена ${market} ${symbol} ${step}: ${errorText(error)}`);
            }
          }
        }
        return list;
      })();
      tickerMemo.set(market, p);
    }
    return p;
  };

  const fundingMemo = new Map<string, Promise<FundingPoint[] | null>>();
  const fundingSeries = (market: ExperimentMarket, symbol: string) => {
    const key = `${market}:${symbol}`;
    let p = fundingMemo.get(key);
    if (!p) {
      p = ctx.history
        .funding(market, symbol, ctx.start - DAY, ctx.end)
        .catch(() => {
          ctx.fundingMissing.add(key);
          return null;
        });
      fundingMemo.set(key, p);
    }
    return p;
  };

  return {
    runner: DEFAULT_RUNNER,
    store: ctx.store,
    cache: new Map(),
    async candles(market, symbol, interval, limit, startTime) {
      const now = clock.now;
      const real: Interval = interval === "1m" ? ctx.exitInterval : interval;
      const ms = INTERVAL_MS[real];
      // Свеча выходов крупнее минуты — под openTime своей последней минуты (см. описание функции).
      const shift = interval === "1m" ? ms - MINUTE : 0;
      const need =
        startTime === undefined
          ? now - (limit + 1) * ms
          : startTime - shift - ms;
      const s = await series.get(market, symbol, real, need);
      const last = lastClosedIndex(s, ms, now);
      const first =
        startTime === undefined
          ? Math.max(0, last - limit + 1)
          : lowerBound(s.openTime, startTime - shift);
      const out: Candle[] = [];
      for (let i = first; i <= last && out.length < limit; i++)
        out.push(candleAt(s, i, shift));
      return out;
    },
    tickers,
    async funding(market) {
      if (!isFuturesMarket(market)) return {};
      const list = await tickers(market);
      const out: Record<string, number> = {};
      const now = clock.now;
      const symbols = await relevant(market, list);
      const points = await Promise.all(
        symbols.map((symbol) => fundingSeries(market, symbol)),
      );
      symbols.forEach((symbol, i) => {
        const p = points[i];
        const rate = p ? fundingAt(p, now) : null;
        if (rate !== null) out[symbol] = rate;
      });
      return out;
    },
  };
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Прогон: тик на каждом закрытии свечи шага от start до end; сделки и отсечённые сигналы — из памяти. */
export async function runBacktest(
  params: BacktestParams,
): Promise<BacktestRun> {
  const step = stepOf(params.experiments);
  const store = backtestStore(params.experiments);
  const series = createSeriesStore(params.history, params.end);
  const errors = new Map<string, number>();
  const note = (message: string) =>
    errors.set(message, (errors.get(message) ?? 0) + 1);
  const clock: TickClock = { now: params.start };
  const fundingMissing = new Set<string>();
  const symbols: BacktestRun["symbols"] = {};
  const deps = createBacktestDeps({
    experiments: params.experiments,
    start: params.start,
    end: params.end,
    exitInterval: params.exitInterval,
    history: params.history,
    series,
    store,
    clock,
    note,
    fundingMissing,
    symbols,
  });
  deps.log = (level, event, message) => {
    // engine.error дублирует result.errors; остальные предупреждения — в общий счёт.
    if (level !== "info" && event !== "engine.error")
      note(`${event}: ${message}`);
  };
  const times = tickTimes(params.start, params.end, TIMEFRAME_MS[step]);
  for (const [i, now] of times.entries()) {
    clock.now = now;
    const result = await runTick(deps, now);
    for (const message of result.errors) note(message);
    params.onTick?.(i + 1, times.length, now, store.trades().length);
  }
  return {
    trades: store.trades(),
    skipped: store.skipped(),
    step,
    ticks: times.length,
    errors: [...errors]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count),
    fundingMissing: [...fundingMissing].sort(),
    symbols,
    series,
  };
}

// --- Данные для отчёта ---

/** Свечи ТФ экспериментов для «после выхода» и исхода отсечённых сигналов — из уже загруженных рядов. */
export async function backtestKlines(
  run: Pick<BacktestRun, "trades" | "skipped" | "series">,
  experiments: Experiment[],
  start: number,
  end: number,
): Promise<KlineSet> {
  const tf = new Map(experiments.map((e) => [e.id, e.config.timeframe]));
  const keys = new Map<
    string,
    { market: ExperimentMarket; symbol: string; tf: Timeframe }
  >();
  for (const x of [...run.trades, ...run.skipped]) {
    const t = tf.get(x.experimentId);
    if (t)
      keys.set(klineKey(x.market, x.symbol, t), {
        market: x.market,
        symbol: x.symbol,
        tf: t,
      });
  }
  const set: KlineSet = new Map();
  for (const [key, k] of keys) {
    try {
      const s = await run.series.get(k.market, k.symbol, k.tf, start);
      const last = lastClosedIndex(s, TIMEFRAME_MS[k.tf], end);
      const from = lowerBound(s.openTime, start);
      const candles: Candle[] = [];
      for (let i = from; i <= last; i++) candles.push(candleAt(s, i));
      set.set(key, candles);
    } catch {
      // Нет свечей — «после выхода» по этому символу просто не посчитается.
    }
  }
  return set;
}

/** Контекст рынка (BTC spot 4h/1d) на отрезок [from, to] — из истории, как `pnpm lab:report` с публичного API. */
export async function backtestMarketContext(
  series: SeriesStore,
  start: number,
  from: number,
  to: number,
): Promise<MarketContext | null> {
  try {
    const [h4, d1] = await Promise.all([
      series.get("spot", "BTCUSDT", "4h", start - WARMUP_BARS * H4),
      series.get("spot", "BTCUSDT", "1d", start - 100 * DAY),
    ]);
    const closed = (s: Series, ms: number) => {
      const out: Candle[] = [];
      for (let i = 0; i <= lastClosedIndex(s, ms, to); i++)
        out.push(candleAt(s, i));
      return out;
    };
    return computeMarketContext({
      symbol: "BTCUSDT",
      h4: closed(h4, H4),
      d1: closed(d1, DAY),
      periodStart: from,
      now: to,
    });
  } catch {
    return null;
  }
}

// --- Отчёт ---

export interface BacktestMeta {
  generatedAt: string;
  /** Эксперименты, заданные в --ids. */
  ids: string[];
  /** Контроль «случайный вход», добавленный в прогон автоматически. */
  controlsAdded: string[];
  periodStart: string;
  periodEnd: string;
  days: number;
  step: Timeframe;
  ticks: number;
  exitInterval: ExitInterval;
  /** Точность выбрана автоматически (а не флагом --exit-tf). */
  exitAuto: boolean;
  split: { fraction: number; at: string } | null;
  /** Снимок списка торгуемых символов по группам: сколько и когда. */
  symbols: Partial<
    Record<ExperimentMarket, { count: number; snapshotAt: string }>
  >;
  fundingMissing: string[];
  /** Сделок, открытых на конец периода (в метрики не входят). */
  openAtEnd: number;
  errors: { message: string; count: number }[];
  download: HistoryStats | null;
  cache: string | null;
  limitations: string[];
}

/** Ограничения бэктеста — в шапку отчёта: чем он не является. */
export function limitationsOf(input: {
  experiments: Experiment[];
  exitInterval: ExitInterval;
  step: Timeframe;
  symbols: BacktestMeta["symbols"];
  fundingMissing: string[];
  openAtEnd: number;
}): string[] {
  const out = [
    "Исполнение оптимистичное: вход по цене на момент тика (close свечи) + слиппедж ядра 0,05 %; стакан, частичное исполнение и задержки не моделируются.",
  ];
  out.push(
    input.exitInterval === "1m"
      ? "Выходы — по 1m-свечам, как в живом движке."
      : `Выходы — по ${input.exitInterval}-свечам (приближение): порядок цен внутри свечи неизвестен — стоп и тейк в одной свече засчитываются как стоп; время выхода, тайм-стоп, трейлинг и безубыток — с точностью до свечи ${input.exitInterval}.`,
  );
  const ranked = input.experiments.some((e) =>
    ["top", "movers"].includes(e.config.universe.type),
  );
  const snapshots = Object.entries(input.symbols)
    .map(([m, s]) => `${m} — ${s.count} на ${s.snapshotAt.slice(0, 10)}`)
    .join(", ");
  out.push(
    ranked
      ? `Смещение выживших: top/movers — по историческому обороту 24 ч среди символов, которые торгуются сейчас (${snapshots}); монеты, делистнутые за период, в юниверс не попадают — результат оптимистичнее.`
      : `Юниверс — только символы, которые торгуются сейчас (${snapshots}).`,
  );
  out.push(
    "Оборот и изменение за 24 ч — по часовым свечам до последнего полного часа; цена внутри часа — close закрытой свечи шага.",
  );
  if (input.experiments.some((e) => isFuturesMarket(e.market)))
    out.push(
      `Funding — последняя выплаченная к тику ставка (история fundingRate; живой движок видит оценку следующей выплаты); в PnL не учитывается, как и в движке.${input.fundingMissing.length ? ` Нет истории — ставки нет (сигнал funding не срабатывает, в контексте входа null): ${input.fundingMissing.length} символов.` : ""}`,
    );
  if (input.experiments.some((e) => e.config.entry.type === "hold"))
    out.push(
      `hold пробует войти раз в шаг тика (${input.step}), а не раз в минуту.`,
    );
  out.push(
    "Отсечённые сигналы пишутся без лимита объёма и срока хранения прод-БД.",
  );
  if (input.openAtEnd)
    out.push(
      `Открыто на конец периода: ${input.openAtEnd} сделок — не закрыты и в метрики не входят.`,
    );
  return out;
}

/** Сводка части периода для таблиц --split. */
export interface PartStats {
  closed: number;
  pnl: number;
  winRate: number | null;
  profitFactor: number | null;
  avgR: number | null;
  tR: number | null;
  returnPct: number | null;
}

export interface SplitRow {
  id: string;
  name: string;
  train: PartStats;
  test: PartStats;
}

const partStats = (e: ExperimentReport | undefined): PartStats => ({
  closed: e?.stats.closed ?? 0,
  pnl: e?.stats.realizedPnl ?? 0,
  winRate: e?.stats.winRate ?? null,
  profitFactor: e?.stats.profitFactor ?? null,
  avgR: e?.r.mean ?? null,
  tR: e?.r.t ?? null,
  returnPct: e?.returnPct.mean ?? null,
});

/** Строки сравнения обучающей и проверочной частей — в порядке экспериментов полного отчёта. */
export function splitRows(
  full: LabReport,
  train: LabReport,
  test: LabReport,
): SplitRow[] {
  const byId = (r: LabReport) => new Map(r.experiments.map((e) => [e.id, e]));
  const a = byId(train);
  const b = byId(test);
  return full.experiments.map((e) => ({
    id: e.id,
    name: e.name,
    train: partStats(a.get(e.id)),
    test: partStats(b.get(e.id)),
  }));
}

/** Делит сделки и отсечённые сигналы по времени входа (сигнала): до at — обучающая часть, с at — проверочная. */
export function splitAt<T extends { openedAt?: string; at?: string }>(
  rows: T[],
  at: number,
): { train: T[]; test: T[] } {
  const time = (r: T) => Date.parse(r.openedAt ?? r.at ?? "");
  return {
    train: rows.filter((r) => time(r) < at),
    test: rows.filter((r) => time(r) >= at),
  };
}

const num = (v: number | null, digits = 2) =>
  v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
const signed = (v: number | null, digits = 2) =>
  v === null || !Number.isFinite(v)
    ? "—"
    : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
const share = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`;
const diff = (a: number | null, b: number | null) =>
  a === null || b === null ? null : b - a;

function partTable(rows: SplitRow[], part: "train" | "test"): string[] {
  return [
    "| id | Эксперимент | Закрыто | PnL $ | Win | PF | avg R | t(R) | Доходн. % |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => {
      const p = r[part];
      return `| ${r.id} | ${r.name} | ${p.closed} | ${signed(p.pnl)} | ${share(p.winRate)} | ${num(p.profitFactor)} | ${num(p.avgR)} | ${num(p.tR)} | ${signed(p.returnPct, 3)} |`;
    }),
  ];
}

/** Раздел --split: таблица обучающей части, проверочной и разница (проверочная − обучающая). */
export function renderSplit(
  rows: SplitRow[],
  meta: Pick<BacktestMeta, "periodStart" | "periodEnd"> & {
    split: NonNullable<BacktestMeta["split"]>;
  },
): string[] {
  const day = (iso: string) => iso.slice(0, 16).replace("T", " ");
  const sameSign = (r: SplitRow) =>
    r.train.avgR === null || r.test.avgR === null
      ? "—"
      : Math.sign(r.train.avgR) === Math.sign(r.test.avgR)
        ? "да"
        : "нет";
  return [
    `## Обучающая и проверочная части (--split ${meta.split.fraction})`,
    "",
    "Один непрерывный прогон; сделка относится к части по времени входа. Вывод делается по проверочной части: перевес, который есть только на обучающей, — подгонка.",
    "",
    `### Обучающая: ${day(meta.periodStart)} — ${day(meta.split.at)}`,
    "",
    ...partTable(rows, "train"),
    "",
    `### Проверочная: ${day(meta.split.at)} — ${day(meta.periodEnd)}`,
    "",
    ...partTable(rows, "test"),
    "",
    "### Разница (проверочная − обучающая)",
    "",
    "| id | Δ avg R | Δ Доходн. п. п. | Δ Win п. п. | Знак avg R совпал |",
    "|---|---|---|---|---|",
    ...rows.map((r) => {
      const dw = diff(r.train.winRate, r.test.winRate);
      return `| ${r.id} | ${signed(diff(r.train.avgR, r.test.avgR))} | ${signed(diff(r.train.returnPct, r.test.returnPct), 3)} | ${dw === null ? "—" : signed(dw * 100, 0)} | ${sameSign(r)} |`;
    }),
    "",
  ];
}

/** Шапка отчёта бэктеста: период, шаг, точность выходов, юниверс, контроль, загрузка и ошибки. */
export function renderBacktestIntro(meta: BacktestMeta): string[] {
  const day = (iso: string) => iso.slice(0, 16).replace("T", " ");
  const lines = [
    `Сформирован ${meta.generatedAt}. Бэктест по истории Binance: ${day(meta.periodStart)} — ${day(meta.periodEnd)} UTC (${num(meta.days, 1)} дн.), шаг тика ${meta.step} (${meta.ticks} тиков), выходы по ${meta.exitInterval}-свечам${meta.exitAuto ? " (выбрано автоматически)" : " (--exit-tf)"}.`,
    `Эксперименты: ${meta.ids.join(", ")}${meta.controlsAdded.length ? `; контроль добавлен автоматически: ${meta.controlsAdded.join(", ")}` : ""}.`,
  ];
  if (meta.download)
    lines.push(
      `Загрузка: ${meta.download.requests} запросов к Binance (вес ${meta.download.weight}), из кэша — ${meta.download.cacheHits} рядов${meta.cache ? ` (${meta.cache})` : ""}.`,
    );
  if (meta.errors.length) {
    const total = meta.errors.reduce((s, e) => s + e.count, 0);
    lines.push(
      `Ошибки данных: ${total} (разных — ${meta.errors.length}); чаще всего: ${meta.errors
        .slice(0, 3)
        .map((e) => `«${e.message}» × ${e.count}`)
        .join("; ")}.`,
    );
  }
  return lines;
}

export interface BacktestReportInput {
  experiments: Experiment[];
  trades: PaperTrade[];
  skipped: SkippedSignal[];
  start: number;
  end: number;
  meta: BacktestMeta;
  /** Контекст рынка: весь период и части --split. */
  market: {
    full: MarketContext | null;
    train?: MarketContext | null;
    test?: MarketContext | null;
  };
  klines: KlineSet | null;
}

export type BacktestReport = LabReport & {
  backtest: BacktestMeta;
  split: {
    at: string;
    rows: SplitRow[];
    train: LabReport;
    test: LabReport;
  } | null;
};

/** Отчёт бэктеста: LabReport всего периода (+ части --split) и markdown. */
export function buildBacktestReport(input: BacktestReportInput): {
  report: BacktestReport;
  md: string;
} {
  const { meta } = input;
  const experiments = input.experiments.map((e) => ({
    ...e,
    enabled: true,
    resetAt: null,
  }));
  const part = (
    from: number,
    to: number,
    trades: PaperTrade[],
    skipped: SkippedSignal[],
    market: MarketContext | null,
  ) => {
    const data: LabDataset = {
      run: {
        id: 1,
        startedAt: new Date(from).toISOString(),
        endedAt: new Date(to).toISOString(),
      },
      experiments,
      trades,
      skipped,
    };
    return buildLabReport(data, {
      now: to,
      database: "бэктест — история Binance",
      market,
      klines: input.klines,
    });
  };
  const full = part(
    input.start,
    input.end,
    input.trades,
    input.skipped,
    input.market.full,
  );
  let split: BacktestReport["split"] = null;
  if (meta.split) {
    const at = Date.parse(meta.split.at);
    const trades = splitAt(input.trades, at);
    const skipped = splitAt(input.skipped, at);
    const train = part(
      input.start,
      at,
      trades.train,
      skipped.train,
      input.market.train ?? null,
    );
    const test = part(
      at,
      input.end,
      trades.test,
      skipped.test,
      input.market.test ?? null,
    );
    split = {
      at: meta.split.at,
      rows: splitRows(full, train, test),
      train,
      test,
    };
  }
  const report: BacktestReport = { ...full, backtest: meta, split };
  const md = renderLabReport(full, {
    title: "Бэктест лаборатории",
    intro: renderBacktestIntro(meta),
    sections: [
      "## Ограничения бэктеста",
      "",
      ...meta.limitations.map((l) => `- ${l}`),
      "",
      ...(split && meta.split
        ? renderSplit(split.rows, { ...meta, split: meta.split })
        : []),
    ],
  });
  return { report, md };
}

// --- Выбор экспериментов и аргументы ---

/** Контроль «случайный вход» группы из каталога (S19, F19); у COIN-M контроля в каталоге нет. */
export function controlFor(
  market: ExperimentMarket,
  catalog: readonly Experiment[],
): Experiment | undefined {
  return catalog.find(
    (e) => e.market === market && e.config.entry.type === "random",
  );
}

/**
 * Эксперименты прогона: --ids из каталога и --file (id файлов с каталогом не пересекаются — это проверяет разбор
 * lab:private), плюс контроль «случайный вход» каждой группы, если его нет и он не выключен.
 */
export function selectExperiments(
  ids: string[],
  catalog: readonly Experiment[],
  fromFile: readonly Experiment[],
  withControl: boolean,
):
  | { ok: true; experiments: Experiment[]; controlsAdded: string[] }
  | { ok: false; error: string } {
  const pool = new Map(
    [...catalog, ...fromFile].map((e) => [e.id.toUpperCase(), e]),
  );
  const unknown = ids.filter((id) => !pool.has(id.toUpperCase()));
  if (unknown.length)
    return {
      ok: false,
      error: `нет экспериментов ${unknown.join(", ")} (каталог${fromFile.length ? " и --file" : ""})`,
    };
  const chosen = [...new Set(ids.map((id) => id.toUpperCase()))].flatMap(
    (id) => pool.get(id) ?? [],
  );
  const controlsAdded: string[] = [];
  if (withControl)
    for (const market of MARKETS) {
      if (!chosen.some((e) => e.market === market)) continue;
      if (
        chosen.some(
          (e) => e.market === market && e.config.entry.type === "random",
        )
      )
        continue;
      const control = controlFor(market, catalog);
      if (control) {
        chosen.push(control);
        controlsAdded.push(control.id);
      }
    }
  return { ok: true, experiments: chosen, controlsAdded };
}

/**
 * Эксперименты из нескольких --file одним списком. Один id в двух файлах — ошибка: непонятно, какой конфиг гонять
 * (пересечение с каталогом проверяет разбор lab:private каждого файла).
 */
export function mergeFileExperiments(
  files: readonly { file: string; experiments: readonly Experiment[] }[],
): { ok: true; experiments: Experiment[] } | { ok: false; error: string } {
  const where = new Map<string, string>();
  const out: Experiment[] = [];
  for (const { file, experiments } of files)
    for (const e of experiments) {
      const id = e.id.toUpperCase();
      const first = where.get(id);
      if (first !== undefined)
        return {
          ok: false,
          error: `эксперимент ${e.id} есть и в ${first}, и в ${file} — оставьте один`,
        };
      where.set(id, file);
      out.push(e);
    }
  return { ok: true, experiments: out };
}

/** Период: конец — последнее закрытие свечи шага не позже to; начало — на days раньше, тоже по шагу. */
export function backtestPeriod(
  to: number,
  days: number,
  step: Timeframe,
): { start: number; end: number } {
  const ms = TIMEFRAME_MS[step];
  const end = Math.floor(to / ms) * ms;
  const start = Math.floor((end - days * DAY) / ms) * ms;
  return { start, end };
}

/** Точка --split: доля периода, по шагу тика. */
export function splitPoint(
  start: number,
  end: number,
  fraction: number,
  step: Timeframe,
): number {
  const ms = TIMEFRAME_MS[step];
  return start + Math.floor(((end - start) * fraction) / ms) * ms;
}

/** Короткий детерминированный хэш параметров прогона — имя каталога по умолчанию. */
export function runHash(parts: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const DEFAULT_DAYS = 120;
export const DEFAULT_OUT_ROOT = "private/lab/backtests";

export interface BacktestArgs {
  ids: string[];
  /** Файлы экспериментов в формате private/experiments.json (--file можно повторять). */
  files: string[];
  days: number;
  /** Конец периода, мс; null — сейчас. */
  to: number | null;
  split: number | null;
  /** null — автоматически (AC3). */
  exitInterval: ExitInterval | null;
  out: string | null;
  cache: string | null;
  noDownload: boolean;
  noControl: boolean;
}

/** Разбор аргументов `pnpm lab:backtest`. */
export function parseBacktestArgs(values: {
  ids?: string[];
  file?: string[];
  days?: string;
  to?: string;
  split?: string;
  "exit-tf"?: string;
  out?: string;
  cache?: string;
  "no-download"?: boolean;
  "no-control"?: boolean;
}): { ok: true; args: BacktestArgs } | { ok: false; error: string } {
  const ids = (values.ids ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  if (!ids.length)
    return {
      ok: false,
      error: "нужен --ids <id[,id…]>, например --ids F19,F15",
    };
  const days = values.days === undefined ? DEFAULT_DAYS : Number(values.days);
  if (!Number.isFinite(days) || days <= 0 || days > 1000)
    return {
      ok: false,
      error: `--days: число дней 1…1000, а не «${values.days}»`,
    };
  let to: number | null = null;
  if (values.to !== undefined) {
    to = Date.parse(values.to);
    if (!Number.isFinite(to))
      return {
        ok: false,
        error: `--to: дата ISO (2026-10-01), а не «${values.to}»`,
      };
  }
  let split: number | null = null;
  if (values.split !== undefined) {
    split = Number(values.split);
    if (!Number.isFinite(split) || split <= 0 || split >= 1)
      return {
        ok: false,
        error: `--split: доля обучающей части (0…1), например 0.66, а не «${values.split}»`,
      };
  }
  const tf = values["exit-tf"];
  if (
    tf !== undefined &&
    tf !== "auto" &&
    !EXIT_INTERVALS.some((x) => x === tf)
  )
    return {
      ok: false,
      error: `--exit-tf: auto, ${EXIT_INTERVALS.join(", ")}, а не «${tf}»`,
    };
  return {
    ok: true,
    args: {
      ids,
      files: values.file ?? [],
      days,
      to,
      split,
      exitInterval:
        tf === undefined || tf === "auto"
          ? null
          : (EXIT_INTERVALS.find((x) => x === tf) ?? null),
      out: values.out ?? null,
      cache: values.cache ?? null,
      noDownload: values["no-download"] ?? false,
      noControl: values["no-control"] ?? false,
    },
  };
}
