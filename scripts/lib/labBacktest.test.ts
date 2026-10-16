import type {
  Candle,
  Experiment,
  ExperimentConfig,
  ExperimentMarket,
  PaperTrade,
} from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import {
  type Interval,
  type MarketTicker,
  pickUniverse,
  runTick,
  type TickDeps,
} from "@/features/paper-engine";
import {
  backtestOpenPricing,
  backtestPeriod,
  backtestStore,
  buildBacktestReport,
  chooseExitInterval,
  createBacktestDeps,
  createSeriesStore,
  exitIntervalError,
  fundingAt,
  limitationsOf,
  mergeFileExperiments,
  parseBacktestArgs,
  runBacktest,
  selectExperiments,
  splitAt,
  splitPoint,
  stepOf,
  tickTimes,
} from "./labBacktest";
import {
  type BacktestHistory,
  type FundingPoint,
  type HistoryCandle,
  INTERVAL_MS,
  type MarketSymbol,
  RateLimitStopError,
} from "./labHistory";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** История начинается за двое суток до периода: хватает на ATR, оборот 24 ч и контекст входа. */
const DATA_FROM = Date.parse("2026-09-01T00:00:00Z");
const START = DATA_FROM + 2 * DAY;
const END = START + 2 * DAY;

// --- Синтетический рынок: 1m-путь цены, свечи любого интервала — агрегаты минут ---

type MinuteFn = (symbol: string, t: number) => HistoryCandle;

const phase = (symbol: string) =>
  [...symbol].reduce((s, ch) => s + ch.charCodeAt(0), 0) / 17;

/** Цена — сумма синусов (тренды и откаты), оборот за минуту — масштаб символа × цена. */
function wave(volumeScale: Record<string, number> = {}): MinuteFn {
  const price = (symbol: string, i: number) => {
    const p = phase(symbol);
    return (
      100 *
      (1 + 0.03 * Math.sin(i / 97 + p) + 0.012 * Math.sin(i / 11.3 + 2 * p))
    );
  };
  return (symbol, t) => {
    const i = t / MIN;
    const open = price(symbol, i);
    const close = price(symbol, i + 1);
    const volume = 1 + (i % 13);
    return {
      openTime: t,
      open,
      high: Math.max(open, close) * 1.0004,
      low: Math.min(open, close) * 0.9996,
      close,
      volume,
      quoteVolume: volume * close * (volumeScale[symbol] ?? 1),
    };
  };
}

/** Ровно 100, кроме заданных минут. */
function flat(overrides: Record<number, Partial<HistoryCandle>>): MinuteFn {
  return (_symbol, t) => ({
    openTime: t,
    open: 100,
    high: 100.05,
    low: 99.95,
    close: 100,
    volume: 1,
    quoteVolume: 100,
    ...overrides[t],
  });
}

function aggregate(minutes: HistoryCandle[]): HistoryCandle {
  return {
    openTime: minutes[0].openTime,
    open: minutes[0].open,
    high: Math.max(...minutes.map((m) => m.high)),
    low: Math.min(...minutes.map((m) => m.low)),
    close: minutes[minutes.length - 1].close,
    volume: minutes.reduce((s, m) => s + m.volume, 0),
    quoteVolume: minutes.reduce((s, m) => s + m.quoteVolume, 0),
  };
}

interface Synth {
  minute: MinuteFn;
  symbols: Partial<Record<ExperimentMarket, MarketSymbol[]>>;
  /** Символ торгуется с этого момента (листинг посреди истории). */
  listedFrom?: Record<string, number>;
  funding?: (symbol: string) => FundingPoint[];
}

const listed = (s: Synth, symbol: string) =>
  Math.max(DATA_FROM, s.listedFrom?.[symbol] ?? DATA_FROM);

/** Свеча интервала из минут [openTime, min(openTime + ms, until)); null — минут нет. */
function synthCandle(
  s: Synth,
  symbol: string,
  ms: number,
  openTime: number,
  until = openTime + ms,
): HistoryCandle | null {
  const minutes: HistoryCandle[] = [];
  for (let t = openTime; t < Math.min(openTime + ms, until); t += MIN)
    if (t >= listed(s, symbol)) minutes.push(s.minute(symbol, t));
  return minutes.length ? aggregate(minutes) : null;
}

/** История бэктеста поверх синтетики (вместо диска и Binance). */
function synthHistory(s: Synth): BacktestHistory & {
  requests: { interval: Interval; from: number; to: number }[];
} {
  const requests: { interval: Interval; from: number; to: number }[] = [];
  return {
    requests,
    symbols: async (market) => ({
      symbols: s.symbols[market] ?? [],
      snapshotAt: END,
    }),
    klines: async (_market, symbol, interval, from, to) => {
      requests.push({ interval, from, to });
      const ms = INTERVAL_MS[interval];
      const out: HistoryCandle[] = [];
      for (
        let t = Math.ceil(Math.max(from, DATA_FROM) / ms) * ms;
        t < to;
        t += ms
      ) {
        const c = synthCandle(s, symbol, ms, t);
        if (c) out.push(c);
      }
      return out;
    },
    funding: async (_market, symbol, from, to) =>
      (s.funding?.(symbol) ?? []).filter((f) => f.time >= from && f.time < to),
  };
}

/**
 * «Живые» зависимости тика по той же синтетике — как отвечает Binance: последняя свеча незакрыта (минуты до now),
 * тикеры 24 ч — по минутам скользящего окна, funding — последняя выплата. Эталон для сравнения с бэктестом.
 */
function liveDeps(
  s: Synth,
  store: TickDeps["store"],
  clock: { now: number },
): TickDeps {
  return {
    runner: "oracle",
    store,
    cache: new Map(),
    candles: async (_m, symbol, interval, limit, startTime) => {
      const now = clock.now;
      const ms = INTERVAL_MS[interval];
      const current = Math.floor(now / ms) * ms;
      const size = Math.min(limit, 1000);
      let first =
        startTime === undefined
          ? current - (size - 1) * ms
          : Math.ceil(startTime / ms) * ms;
      first = Math.max(first, Math.ceil(listed(s, symbol) / ms) * ms);
      const out: Candle[] = [];
      for (let t = first; t <= current && out.length < size; t += ms) {
        const c =
          t === current
            ? (synthCandle(s, symbol, ms, t, now) ?? {
                ...s.minute(symbol, t),
                volume: 0,
              })
            : synthCandle(s, symbol, ms, t);
        if (c) out.push(c);
      }
      return out;
    },
    tickers: async (market) => {
      const now = clock.now;
      const out: MarketTicker[] = [];
      for (const { symbol, contractSize } of s.symbols[market] ?? []) {
        if (listed(s, symbol) >= now) continue;
        const from = Math.max(now - DAY, listed(s, symbol));
        let quoteVolume = 0;
        for (let t = from; t < now; t += MIN)
          quoteVolume += s.minute(symbol, t).quoteVolume;
        const lastPrice = s.minute(symbol, now - MIN).close;
        out.push({
          symbol,
          lastPrice,
          priceChangePercent:
            (lastPrice / s.minute(symbol, from).open - 1) * 100,
          quoteVolume,
          ...(contractSize ? { contractSize } : {}),
        });
      }
      return out;
    },
    funding: async (market) => {
      if (market === "spot") return {};
      const out: Record<string, number> = {};
      for (const { symbol } of s.symbols[market] ?? []) {
        const rate = fundingAt(s.funding?.(symbol) ?? [], clock.now);
        if (rate !== null) out[symbol] = rate;
      }
      return out;
    },
  };
}

// Фиктивные эксперименты (приватные — только в private/): PS99 — spot, PF99 — USDⓈ-M.
const exp = (
  id: string,
  market: ExperimentMarket,
  patch: Partial<ExperimentConfig> = {},
): Experiment => ({
  id,
  market,
  name: id,
  hypothesis: "тест",
  initialBudget: 10_000,
  enabled: true,
  demoMirror: false,
  config: {
    timeframe: "1h",
    entry: { type: "random", probability: 0.5 },
    exit: { stop: { type: "atr", mult: 2 }, takeProfit: { type: "rr", r: 2 } },
    universe: { type: "top", n: 2 },
    directions: ["long", "short"],
    maxOpen: 3,
    ...patch,
  },
});

const SYMBOLS: MarketSymbol[] = [
  { symbol: "ALFUSDT" },
  { symbol: "BETUSDT" },
  { symbol: "GAMUSDT" },
];

const synth = (over: Partial<Synth> = {}): Synth => ({
  minute: wave({ ALFUSDT: 1000, BETUSDT: 100, GAMUSDT: 1 }),
  symbols: { spot: SYMBOLS, usdm: SYMBOLS },
  funding: (symbol) =>
    Array.from({ length: 12 }, (_, i) => ({
      time: DATA_FROM + i * 8 * HOUR,
      rate: (phase(symbol) % 1) / 1000 - 0.0003 + i * 1e-5,
    })),
  ...over,
});

const EXPERIMENTS = [
  exp("PS99", "spot", { directions: ["long"] }),
  exp("PF99", "usdm", {
    entry: { type: "random", probability: 0.6 },
    exit: {
      stop: { type: "atr", mult: 1.5 },
      takeProfit: null,
      trailAtr: 1,
      breakevenAtR: 0.5,
    },
    universe: { type: "symbols", symbols: ["ALF", "BET"] },
  }),
];

const byId = (trades: PaperTrade[]) =>
  [...trades].sort((a, b) => a.id.localeCompare(b.id));

describe("бэктест = повтор runTick (AC1)", () => {
  it("на синтетике сделки и отсечённые сигналы совпадают с прямыми вызовами runTick", async () => {
    const s = synth();
    const run = await runBacktest({
      experiments: EXPERIMENTS,
      start: START,
      end: END,
      exitInterval: "1m",
      history: synthHistory(s),
    });

    const store = backtestStore(EXPERIMENTS);
    const clock = { now: START };
    const deps = liveDeps(s, store, clock);
    for (const now of tickTimes(START, END, HOUR)) {
      clock.now = now;
      await runTick(deps, now);
    }

    expect(run.errors).toEqual([]);
    expect(run.trades.length).toBeGreaterThan(10);
    expect(
      run.trades.filter((t) => t.closedAt !== null).length,
    ).toBeGreaterThan(5);
    expect(byId(run.trades)).toEqual(byId(store.trades()));
    expect(run.skipped).toEqual(store.skipped());
  });
});

describe("нет заглядывания вперёд (AC2)", () => {
  it("выгодная будущая свеча не меняет сделки, открытые и закрытые до неё", async () => {
    const pumpAt = START + DAY + 30 * MIN;
    const base = wave({ ALFUSDT: 1000, BETUSDT: 100, GAMUSDT: 1 });
    // После pumpAt цена всех символов на 50 % выше: стопы шортов, тейки лонгов — в будущем.
    const pumped: MinuteFn = (symbol, t) => {
      const c = base(symbol, t);
      if (t < pumpAt) return c;
      return {
        ...c,
        open: c.open * 1.5,
        high: c.high * 1.5,
        low: c.low * 1.5,
        close: c.close * 1.5,
      };
    };
    const runWith = (minute: MinuteFn) =>
      runBacktest({
        experiments: EXPERIMENTS,
        start: START,
        end: END,
        exitInterval: "5m",
        history: synthHistory(synth({ minute })),
      });
    const [plain, future] = await Promise.all([runWith(base), runWith(pumped)]);
    const before = (trades: PaperTrade[]) =>
      byId(trades.filter((t) => Date.parse(t.openedAt) < pumpAt));
    const closedBefore = (trades: PaperTrade[]) =>
      byId(
        trades.filter(
          (t) => t.closedAt !== null && Date.parse(t.closedAt) < pumpAt,
        ),
      );
    const entry = ({
      closedAt: _c,
      exitPrice: _e,
      exitReason: _r,
      pnl: _p,
      rMultiple: _m,
      fees: _f,
      stop: _s,
      extreme: _x,
      mae: _a,
      checkedUntil: _u,
      ...rest
    }: PaperTrade) => rest;

    expect(before(plain.trades).length).toBeGreaterThan(5);
    expect(before(future.trades).map(entry)).toEqual(
      before(plain.trades).map(entry),
    );
    expect(closedBefore(future.trades)).toEqual(closedBefore(plain.trades));
    // А после скачка история действительно другая.
    expect(byId(future.trades)).not.toEqual(byId(plain.trades));
  });

  it("зависимости тика не отдают незакрытых к now свечей, в том числе свечей выходов", async () => {
    const s = synth();
    const store = backtestStore(EXPERIMENTS);
    const clock = { now: START + 6 * HOUR };
    const history = synthHistory(s);
    const deps = createBacktestDeps({
      experiments: EXPERIMENTS,
      start: START,
      end: END,
      exitInterval: "5m",
      history,
      series: createSeriesStore(history, END),
      store,
      clock,
      note: () => {},
      fundingMissing: new Set(),
      symbols: {},
    });
    const now = clock.now;
    const hourly = await deps.candles("usdm", "ALFUSDT", "1h", 301);
    expect(hourly.at(-1)?.openTime).toBe(now - HOUR);
    expect(hourly.every((c) => c.openTime + HOUR <= now)).toBe(true);
    // «1m» при выходах по 5m: свеча [S, S+5m) — с openTime последней минуты, закрыта к now.
    const exits = await deps.candles("usdm", "ALFUSDT", "1m", 1000, now - HOUR);
    expect(exits).toHaveLength(12);
    expect(exits[0].openTime).toBe(now - HOUR + 4 * MIN);
    expect(exits.every((c) => c.openTime + MIN <= now)).toBe(true);
    const [ticker] = (await deps.tickers("usdm")).filter(
      (t) => t.symbol === "ALFUSDT",
    );
    expect(ticker.lastPrice).toBe(s.minute("ALFUSDT", now - MIN).close);
  });
});

describe("точность выходов (AC3)", () => {
  it("1m для ≤ 30 дней и юниверса ≤ 10, иначе 5m", () => {
    const majors = exp("PF99", "usdm", { universe: { type: "majors" } });
    const top30 = exp("PF98", "usdm", { universe: { type: "top", n: 30 } });
    expect(chooseExitInterval(14, [majors])).toBe("1m");
    expect(chooseExitInterval(31, [majors])).toBe("5m");
    expect(chooseExitInterval(14, [majors, top30])).toBe("5m");
  });

  it("--exit-tf крупнее шага тика отклоняется: свеча выходов начиналась бы до входа", async () => {
    expect(exitIntervalError("15m", "5m")).toMatch(/крупнее шага тика 5m/);
    expect(exitIntervalError("5m", "5m")).toBeNull();
    expect(exitIntervalError("15m", "1h")).toBeNull();
    await expect(
      runBacktest({
        experiments: [exp("PS99", "spot", { timeframe: "5m" })],
        start: START,
        end: START + HOUR,
        exitInterval: "15m",
        history: synthHistory(synth()),
      }),
    ).rejects.toThrow(/--exit-tf 15m/);
  });

  it("стоп и тейк в одной свече выходов: по 1m — тейк, по 5m — засчитывается стоп", async () => {
    // Вход в START по 100 (+ слиппедж); через минуту — тейк +1 %, ещё через минуту — стоп −1 %, обе внутри 5m-свечи.
    const s = synth({
      minute: flat({
        [START + MIN]: { high: 101.5, close: 100 },
        [START + 2 * MIN]: { low: 98.5, close: 100 },
      }),
      symbols: { spot: [{ symbol: "ALFUSDT" }] },
    });
    const experiments = [
      exp("PS99", "spot", {
        entry: { type: "hold" },
        exit: {
          stop: { type: "pct", pct: 1 },
          takeProfit: { type: "pct", pct: 1 },
        },
        universe: { type: "symbols", symbols: ["ALF"] },
        directions: ["long"],
        maxOpen: 1,
      }),
    ];
    const first = async (exitInterval: "1m" | "5m") => {
      const run = await runBacktest({
        experiments,
        start: START,
        end: START + 2 * HOUR,
        exitInterval,
        history: synthHistory(s),
      });
      return byId(run.trades)[0];
    };
    const minute = await first("1m");
    const coarse = await first("5m");
    expect(minute.openedAt).toBe(new Date(START).toISOString());
    expect(minute.exitReason).toBe("tp");
    expect(coarse.exitReason).toBe("sl");
    expect(coarse.pnl).toBeLessThan(0);
    expect(minute.pnl).toBeGreaterThan(0);
  });
});

describe("юниверс по историческому обороту (AC4)", () => {
  it("top-N — по обороту на момент тика, без не-крипто, стейблов и ещё не листингованных", async () => {
    // ALF — оборот в первые сутки, BET — во вторые; PAXG и USDC — самые ликвидные, но не крипта/стейбл;
    // DEL листингуется только на вторые сутки периода.
    const half = START + DAY;
    const base = wave();
    const minute: MinuteFn = (symbol, t) => {
      const c = base(symbol, t);
      const scale: Record<string, number> =
        t < half - DAY / 2
          ? { ALFUSDT: 1000, BETUSDT: 10, DELUSDT: 1 }
          : { ALFUSDT: 10, BETUSDT: 1000, DELUSDT: 1 };
      const extra = symbol === "PAXGUSDT" || symbol === "USDCUSDT" ? 1e6 : 1;
      return {
        ...c,
        quoteVolume: c.quoteVolume * (scale[symbol] ?? 1) * extra,
      };
    };
    const s = synth({
      minute,
      symbols: {
        spot: ["ALFUSDT", "BETUSDT", "DELUSDT", "PAXGUSDT", "USDCUSDT"].map(
          (symbol) => ({ symbol }),
        ),
      },
      listedFrom: { DELUSDT: half },
    });
    const experiments = [
      exp("PS99", "spot", { universe: { type: "top", n: 1 } }),
    ];
    const history = synthHistory(s);
    const clock = { now: START };
    const deps = createBacktestDeps({
      experiments,
      start: START,
      end: END,
      exitInterval: "5m",
      history,
      series: createSeriesStore(history, END),
      store: backtestStore(experiments),
      clock,
      note: () => {},
      fundingMissing: new Set(),
      symbols: {},
    });
    const top = async (now: number) => {
      clock.now = now;
      const list = await deps.tickers("spot");
      return {
        symbols: list.map((t) => t.symbol),
        top: pickUniverse(experiments[0].config.universe, list, "spot"),
      };
    };
    const day1 = await top(START + 2 * HOUR);
    expect(day1.top).toEqual(["ALFUSDT"]);
    expect(day1.symbols).not.toContain("DELUSDT");
    const day2 = await top(END);
    expect(day2.top).toEqual(["BETUSDT"]);
    expect(day2.symbols).toContain("DELUSDT");
  });
});

describe("отчёт и --split (AC5)", () => {
  it("две таблицы частей, разница и шапка с ограничениями", async () => {
    const run = await runBacktest({
      experiments: EXPERIMENTS,
      start: START,
      end: END,
      exitInterval: "1m",
      history: synthHistory(synth()),
    });
    const at = splitPoint(START, END, 0.5, "1h");
    const symbols = { usdm: { count: 3, snapshotAt: "2026-09-05T00:00:00Z" } };
    const limitations = limitationsOf({
      experiments: EXPERIMENTS,
      exitInterval: "5m",
      step: "1h",
      symbols,
      fundingMissing: [],
      openAtEnd: 2,
    });
    const { report, md } = buildBacktestReport({
      experiments: EXPERIMENTS,
      trades: run.trades,
      skipped: run.skipped,
      start: START,
      end: END,
      market: { full: null },
      klines: null,
      meta: {
        generatedAt: new Date(END).toISOString(),
        ids: ["PS99", "PF99"],
        controlsAdded: [],
        periodStart: new Date(START).toISOString(),
        periodEnd: new Date(END).toISOString(),
        days: 2,
        step: "1h",
        ticks: run.ticks,
        exitInterval: "5m",
        exitAuto: true,
        split: { fraction: 0.5, at: new Date(at).toISOString() },
        symbols,
        fundingMissing: [],
        openAtEnd: 2,
        errors: [],
        download: null,
        cache: null,
        limitations,
      },
    });
    expect(report.backtest.exitInterval).toBe("5m");
    expect(report.split?.rows.map((r) => r.id).sort()).toEqual([
      "PF99",
      "PS99",
    ]);
    const { train, test } = splitAt(run.trades, at);
    const closed = (ts: PaperTrade[], id: string) =>
      ts.filter((t) => t.experimentId === id && t.closedAt !== null).length;
    const pf = report.split?.rows.find((r) => r.id === "PF99");
    expect(pf?.train.closed).toBe(closed(train, "PF99"));
    expect(pf?.test.closed).toBe(closed(test, "PF99"));
    expect(md).toMatch(/^# Бэктест лаборатории/);
    expect(md).toContain("## Ограничения бэктеста");
    expect(md).toContain("стоп и тейк в одной свече засчитываются как стоп");
    expect(md).toContain("Смещение выживших");
    expect(md).toContain("### Обучающая");
    expect(md).toContain("### Проверочная");
    expect(md).toContain("### Разница (проверочная − обучающая)");
    expect(md).toContain("## Сводка");
    // Шапка — бэктеста, а не эпохи; группы без экспериментов в строках контроля не показываются.
    expect(md).not.toContain("учёта эпохи");
    expect(md).toContain("закрытые за период бэктеста");
    expect(md).not.toMatch(/coinm — нет/);
  });
});

describe("открытые на конец периода по последней цене (баг 0041)", () => {
  const position = (symbol: string, closedAt: string | null = null) =>
    ({
      experimentId: "PF99",
      market: "usdm",
      symbol,
      openedAt: new Date(START).toISOString(),
      closedAt,
    }) as PaperTrade;

  it("close последней свечи выходов, закрытой к концу периода; без свечей — без цены; закрытые не нужны", async () => {
    const s = synth({
      // Минута END ещё не закрыта к концу периода — её цену брать нельзя.
      minute: flat({ [END - MIN]: { close: 120 }, [END]: { close: 999 } }),
      listedFrom: { LATEUSDT: END + DAY },
    });
    const series = createSeriesStore(synthHistory(s), END);
    const pricing = await backtestOpenPricing(
      {
        trades: [
          position("ALFUSDT"),
          position("LATEUSDT"),
          position("BETUSDT", new Date(END).toISOString()),
        ],
        series,
      },
      "5m",
      END,
    );
    expect(pricing?.prices).toEqual({ "usdm:ALFUSDT": 120 });
    expect(pricing?.at).toBe(new Date(END).toISOString());
    expect(pricing?.source).toContain("5m");
    expect(
      await backtestOpenPricing(
        { trades: [position("ALFUSDT", "2026-09-04T00:00:00Z")], series },
        "5m",
        END,
      ),
    ).toBeNull();
  });

  it("отчёт: открытые оценены в полном периоде, части --split — без цен", async () => {
    const run = await runBacktest({
      experiments: EXPERIMENTS,
      start: START,
      end: END,
      exitInterval: "1m",
      history: synthHistory(synth()),
    });
    const open = run.trades.filter((t) => t.closedAt === null);
    expect(open.length).toBeGreaterThan(0);
    const openPricing = await backtestOpenPricing(run, "1m", END);
    const at = splitPoint(START, END, 0.5, "1h");
    const { report, md } = buildBacktestReport({
      experiments: EXPERIMENTS,
      trades: run.trades,
      skipped: run.skipped,
      start: START,
      end: END,
      market: { full: null },
      klines: null,
      openPricing,
      meta: {
        generatedAt: new Date(END).toISOString(),
        ids: ["PS99", "PF99"],
        controlsAdded: [],
        periodStart: new Date(START).toISOString(),
        periodEnd: new Date(END).toISOString(),
        days: 2,
        step: "1h",
        ticks: run.ticks,
        exitInterval: "1m",
        exitAuto: true,
        split: { fraction: 0.5, at: new Date(at).toISOString() },
        symbols: {},
        fundingMissing: [],
        openAtEnd: open.length,
        errors: [],
        download: null,
        cache: null,
        limitations: [],
      },
    });
    const unrealized = report.experiments.map((e) => e.unrealized);
    expect(unrealized.reduce((n, u) => n + u.open, 0)).toBe(open.length);
    expect(unrealized.reduce((n, u) => n + u.priced, 0)).toBe(open.length);
    expect(report.openPricing?.source).toContain("1m");
    expect(report.split?.train.openPricing).toBeNull();
    expect(report.split?.test.openPricing).toBeNull();
    expect(md).toContain("Открытые позиции оценены по последней цене");
  });
});

describe("останов по бану Binance (major-1 ревью)", () => {
  it("бан посреди прогона прерывает runBacktest: дальше тиков нет", async () => {
    const base = synthHistory(synth());
    const ban = new RateLimitStopError("api.binance.com: ответ 418", 418);
    let stopped: Error | null = null;
    let klinesCalls = 0;
    const history: BacktestHistory = {
      ...base,
      stopped: () => stopped,
      klines: async (...args) => {
        if (++klinesCalls > 3) {
          stopped = ban;
          throw ban;
        }
        return base.klines(...args);
      },
    };
    const ticks: number[] = [];
    await expect(
      runBacktest({
        experiments: EXPERIMENTS,
        start: START,
        end: END,
        exitInterval: "5m",
        history,
        onTick: (done) => ticks.push(done),
      }),
    ).rejects.toBe(ban);
    expect(ticks).toEqual([]);
  });
});

describe("аргументы и выбор экспериментов", () => {
  const catalog = [
    exp("F19", "usdm", { entry: { type: "random", probability: 0.02 } }),
    exp("S19", "spot", { entry: { type: "random", probability: 0.02 } }),
    exp("F06", "usdm", { entry: { type: "donchian", period: 20 } }),
  ];

  it("добавляет контроль «случайный вход» своей группы, если его нет", () => {
    const r = selectExperiments(
      ["f06", "PF99"],
      catalog,
      [exp("PF99", "usdm", { entry: { type: "hold" } })],
      true,
    );
    expect(r.ok && r.experiments.map((e) => e.id)).toEqual([
      "F06",
      "PF99",
      "F19",
    ]);
    expect(r.ok && r.controlsAdded).toEqual(["F19"]);
    const none = selectExperiments(["F06"], catalog, [], false);
    expect(none.ok && none.controlsAdded).toEqual([]);
    expect(selectExperiments(["PF77"], catalog, [], true)).toMatchObject({
      ok: false,
    });
  });

  it("несколько --file: эксперименты одним списком, один id в двух файлах — ошибка", () => {
    const a = { file: "a.json", experiments: [exp("PF99", "usdm")] };
    const b = { file: "b.json", experiments: [exp("PS99", "spot")] };
    const merged = mergeFileExperiments([a, b]);
    expect(merged.ok && merged.experiments.map((e) => e.id)).toEqual([
      "PF99",
      "PS99",
    ]);
    const dup = mergeFileExperiments([
      a,
      { file: "b.json", experiments: [exp("pf99", "usdm")] },
    ]);
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.error).toContain("a.json");
    expect(!dup.ok && dup.error).toContain("b.json");
  });

  it("разбирает флаги и отклоняет неверные значения", () => {
    const ok = parseBacktestArgs({
      ids: ["F19,f15", "PF99"],
      file: ["a.json", "b.json"],
      days: "14",
      split: "0.66",
      "exit-tf": "15m",
    });
    expect(ok).toMatchObject({
      ok: true,
      args: {
        ids: ["F19", "F15", "PF99"],
        files: ["a.json", "b.json"],
        days: 14,
        split: 0.66,
        exitInterval: "15m",
        noDownload: false,
      },
    });
    expect(parseBacktestArgs({}).ok).toBe(false);
    expect(parseBacktestArgs({ ids: ["F19"], split: "1" }).ok).toBe(false);
    expect(parseBacktestArgs({ ids: ["F19"], "exit-tf": "2m" }).ok).toBe(false);
    expect(parseBacktestArgs({ ids: ["F19"], days: "0" }).ok).toBe(false);
  });

  it("период и шаг: по закрытию свечи самого короткого ТФ", () => {
    expect(
      stepOf([exp("A", "usdm"), exp("B", "usdm", { timeframe: "15m" })]),
    ).toBe("15m");
    const to = Date.parse("2026-10-16T10:37:00Z");
    const p = backtestPeriod(to, 14, "1h");
    expect(new Date(p.end).toISOString()).toBe("2026-10-16T10:00:00.000Z");
    expect(new Date(p.start).toISOString()).toBe("2026-10-02T10:00:00.000Z");
    expect(tickTimes(p.start, p.start + 3 * HOUR, HOUR)).toHaveLength(4);
    expect(splitPoint(p.start, p.end, 0.5, "1h") - p.start).toBe(7 * DAY);
  });

  it("сбой загрузки funding — ошибка данных, а не «нет истории»", async () => {
    const base = synthHistory(synth());
    const run = await runBacktest({
      experiments: [EXPERIMENTS[1]],
      start: START,
      end: START + 3 * HOUR,
      exitInterval: "5m",
      history: {
        ...base,
        funding: async (_m, symbol) => {
          if (symbol === "ALFUSDT") throw new Error("нет в кэше");
          return [];
        },
      },
    });
    expect(run.fundingMissing).toEqual(["usdm:BETUSDT"]);
    expect(run.errors.map((e) => e.message)).toContain(
      "funding usdm ALFUSDT: нет в кэше",
    );
  });

  it("funding — последняя выплата не позже тика", () => {
    const points = [
      { time: 10, rate: 0.1 },
      { time: 20, rate: 0.2 },
    ];
    expect(fundingAt(points, 5)).toBeNull();
    expect(fundingAt(points, 20)).toBe(0.2);
    expect(fundingAt(points, 19)).toBe(0.1);
  });
});
