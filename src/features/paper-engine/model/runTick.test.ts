import type {
  Candle,
  Experiment,
  ExperimentConfig,
} from "@binance-dashboard/trading-core";
import { TIMEFRAME_MS } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import type { MarketTicker } from "../lib/universe";
import { createMemoryStore } from "./memoryStore";
import { type Interval, runTick, type TickDeps } from "./runTick";
import { ENGINE_KEYS } from "./store";

const MIN = 60_000;
const HOUR = 60 * MIN;
// Начало часа: 1h-свеча 11:00 только что закрылась (свежий сигнал), свеча 12:00 — незакрыта.
const T0 = Date.parse("2026-10-10T12:00:00Z");

const exp = (
  id: string,
  patch: Partial<ExperimentConfig> = {},
  market: Experiment["market"] = "futures",
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
    entry: { type: "hold" },
    exit: { stop: { type: "atr", mult: 2 }, takeProfit: { type: "rr", r: 2 } },
    universe: { type: "symbols", symbols: ["BTCUSDT"] },
    directions: ["long", "short"],
    maxOpen: 5,
    ...patch,
  },
});

/** Стратегия, которая на каждой свече даёт long (momentum: единственный символ всегда в топе). */
const ALWAYS_LONG: Partial<ExperimentConfig> = {
  entry: { type: "momentum", lookbackBars: 3, topK: 5 },
};

const MS: Record<Interval, number> = { ...TIMEFRAME_MS, "1m": MIN };

/**
 * Синтетический рынок: цена 100, у каждой свечи high/low ±0,5 (ATR = 1).
 * minute(openTime) меняет отдельные 1m-свечи (касание стопа/тейка).
 */
function market(
  symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  minute: (openTime: number) => Partial<Candle> = () => ({}),
) {
  const calls: { symbol: string; interval: Interval; limit: number }[] = [];
  let now = T0;
  const candles: TickDeps["candles"] = async (_m, symbol, interval, limit) => {
    calls.push({ symbol, interval, limit });
    const ms = MS[interval];
    const current = Math.floor(now / ms) * ms;
    return Array.from({ length: limit }, (_, i) => {
      const openTime = current - (limit - 1 - i) * ms;
      return {
        openTime,
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100,
        volume: 1,
        ...(interval === "1m" ? minute(openTime) : {}),
      };
    });
  };
  const tickers: MarketTicker[] = symbols.map((symbol, i) => ({
    symbol,
    lastPrice: 100,
    priceChangePercent: 0,
    quoteVolume: 1e9 - i,
  }));
  return {
    calls,
    setNow: (t: number) => {
      now = t;
    },
    deps: (store: TickDeps["store"], runner: TickDeps["runner"] = "oracle") =>
      ({
        runner,
        store,
        candles,
        tickers: async () => tickers,
        funding: async () => ({}),
        cache: new Map(),
      }) satisfies TickDeps,
  };
}

const enabledStore = (experiments: Experiment[], state = {}) =>
  createMemoryStore(experiments, { [ENGINE_KEYS.enabled]: true, ...state });

describe("runTick: роль раннера и тумблер", () => {
  it("чужой раннер в engine_state — тик ничего не делает", async () => {
    const store = enabledStore([exp("A")], { runner: "supabase" });
    const m = market();
    const r = await runTick(m.deps(store, "oracle"), T0);
    expect(r.status).toBe("foreign-runner");
    expect(store.trades()).toHaveLength(0);
    expect(m.calls).toHaveLength(0);
  });

  it("свой раннер работает; без runner в состоянии — oracle по умолчанию", async () => {
    const supa = enabledStore([exp("A")], { runner: "supabase" });
    expect((await runTick(market().deps(supa, "supabase"), T0)).status).toBe(
      "ok",
    );
    const fresh = enabledStore([exp("A")]);
    expect((await runTick(market().deps(fresh, "supabase"), T0)).status).toBe(
      "foreign-runner",
    );
    expect((await runTick(market().deps(fresh, "oracle"), T0)).opened).toBe(1);
  });

  it("движок выключен по умолчанию", async () => {
    const store = createMemoryStore([exp("A")]);
    const r = await runTick(market().deps(store), T0);
    expect(r.status).toBe("disabled");
    expect(store.trades()).toHaveLength(0);
  });
});

describe("runTick: входы", () => {
  it("открывает сделку по закрытой свече: слиппедж, стоп 2 ATR, TP 2R, размер от риска", async () => {
    const store = enabledStore([exp("A")]);
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(1);
    const [t] = store.trades();
    expect(t.symbol).toBe("BTCUSDT");
    expect(t.direction).toBe("long");
    expect(t.entryPrice).toBeCloseTo(100.05);
    expect(t.initialStop).toBeCloseTo(98.05);
    expect(t.takeProfit).toBeCloseTo(104.05);
    // Риск 0,5% от 10 000 = 50 USD / 2 = 25 шт., но объём ≤ 10% (1000 USD) → ~9,995 шт.
    expect(t.quantity * t.entryPrice).toBeCloseTo(1000);
    // Незакрытая свеча 12:00 отброшена: сигнал по свече 11:00.
    expect(t.signal.bar).toBe(Date.parse("2026-10-10T11:00:00Z"));
    expect(t.checkedUntil).toBe(T0 + MIN);
  });

  it("повторный тик на той же свече не входит снова и не дублирует сделку", async () => {
    const store = enabledStore([exp("A")]);
    const m = market();
    await runTick(m.deps(store), T0);
    await runTick(m.deps(store), T0);
    m.setNow(T0 + 5 * MIN);
    const r = await runTick(m.deps(store), T0 + 5 * MIN);
    expect(r.evaluated).toEqual([]);
    expect(store.trades()).toHaveLength(1);
  });

  it("стратегия вызывается только при закрытии новой свечи своего TF", async () => {
    const store = enabledStore([exp("A")]);
    const m = market();
    expect((await runTick(m.deps(store), T0)).evaluated).toEqual(["A"]);
    m.setNow(T0 + 20 * MIN);
    expect((await runTick(m.deps(store), T0 + 20 * MIN)).evaluated).toEqual([]);
    m.setNow(T0 + HOUR);
    expect((await runTick(m.deps(store), T0 + HOUR)).evaluated).toEqual(["A"]);
  });

  it("одна позиция на символ: на новой свече hold не открывает вторую", async () => {
    const store = enabledStore([exp("A")]);
    const m = market();
    await runTick(m.deps(store), T0);
    m.setNow(T0 + HOUR);
    await runTick(m.deps(store), T0 + HOUR);
    expect(store.trades().filter((t) => t.closedAt === null)).toHaveLength(1);
  });

  it("maxOpen ограничивает число открытых сделок эксперимента", async () => {
    const store = enabledStore([
      exp("A", {
        universe: { type: "top", n: 3 },
        maxOpen: 2,
      }),
    ]);
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(2);
    expect(store.trades().map((t) => t.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("spot — только long, даже если конфиг разрешает short", async () => {
    const store = enabledStore([
      exp(
        "S",
        { entry: { type: "random", probability: 1 }, directions: ["short"] },
        "spot",
      ),
    ]);
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(0);
  });

  it("эксперименты считаются отдельно: тот же символ в двух экспериментах", async () => {
    const store = enabledStore([exp("A"), exp("B")]);
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(2);
  });

  it("фильтр тренда: long ниже EMA старшего TF не открывается", async () => {
    const store = enabledStore([
      exp("A", { trendFilter: { timeframe: "4h", period: 50 } }),
    ]);
    // Цена 100, EMA тоже 100 — цена не выше EMA → входа нет.
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(0);
  });
});

describe("runTick: устаревшие сигналы", () => {
  it("первый тик после включения: свеча сигнала закрылась 2 ч назад — метка ставится, входа нет", async () => {
    // TF 4h: в 14:00 последняя закрытая свеча — 08:00–12:00, она закрылась 2 ч назад (окно 4h — 12 мин).
    const store = enabledStore([exp("A", { ...ALWAYS_LONG, timeframe: "4h" })]);
    const late = T0 + 2 * HOUR;
    const m = market();
    m.setNow(late);
    const r = await runTick(m.deps(store), late);
    expect(r.evaluated).toEqual(["A"]);
    expect(r.opened).toBe(0);
    expect(await store.getState(ENGINE_KEYS.bars)).toEqual({
      A: Date.parse("2026-10-10T08:00:00Z"),
    });
  });

  it("окно свежести зависит от TF: 1h — 3 мин, 4h — 12 мин, 1d — 72 мин", async () => {
    const cases: [ExperimentConfig["timeframe"], number, number][] = [
      // [TF, момент закрытия свечи, сколько минут прошло → войдёт ли]
      ["1h", T0, 2],
      ["1h", T0, 4],
      ["4h", T0, 11],
      ["4h", T0, 13],
      ["1d", Date.parse("2026-10-10T00:00:00Z"), 70],
      ["1d", Date.parse("2026-10-10T00:00:00Z"), 74],
    ];
    const opened = [];
    for (const [timeframe, closedAt, minutes] of cases) {
      const store = enabledStore([exp("A", { ...ALWAYS_LONG, timeframe })]);
      const m = market();
      const now = closedAt + minutes * MIN;
      m.setNow(now);
      opened.push((await runTick(m.deps(store), now)).opened);
    }
    expect(opened).toEqual([1, 0, 1, 0, 1, 0]);
  });

  it("после устаревшей свечи следующая свежая — входит", async () => {
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    const m = market();
    m.setNow(T0 + 30 * MIN);
    expect((await runTick(m.deps(store), T0 + 30 * MIN)).opened).toBe(0);
    m.setNow(T0 + HOUR);
    expect((await runTick(m.deps(store), T0 + HOUR)).opened).toBe(1);
  });

  it("hold (S20, F20): свежесть не проверяется — входит на старой свече 1d", async () => {
    const store = enabledStore([exp("H", { timeframe: "1d" })]);
    const m = market();
    m.setNow(T0);
    // В 12:00 свеча 1d закрылась 12 ч назад — для другой стратегии входа бы не было.
    expect((await runTick(m.deps(store), T0)).opened).toBe(1);
  });

  it("hold: позиция закрылась посреди свечи — входит снова в следующий тик", async () => {
    const hit = T0 + 2 * MIN;
    const m = market(["BTCUSDT"], (t) => (t === hit ? { high: 105 } : {}));
    const store = enabledStore([exp("H", { maxOpen: 1 })]);
    await runTick(m.deps(store), T0);
    m.setNow(T0 + 4 * MIN);
    const r = await runTick(m.deps(store), T0 + 4 * MIN);
    expect(r.closed).toBe(1);
    expect(r.opened).toBe(1);
    expect(r.evaluated).toEqual([]);
    const ids = store.trades().map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    // Тот же тик повторно — без дублей.
    await runTick(m.deps(store), T0 + 4 * MIN);
    expect(store.trades()).toHaveLength(2);
  });
});

describe("runTick: выходы по 1m-свечам", () => {
  it("закрывает по TP и не входит повторно на той же свече TF", async () => {
    const hit = T0 + 2 * MIN;
    const m = market(["BTCUSDT"], (t) => (t === hit ? { high: 105 } : {}));
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    await runTick(m.deps(store), T0);
    m.setNow(T0 + 4 * MIN);
    const r = await runTick(m.deps(store), T0 + 4 * MIN);
    expect(r.closed).toBe(1);
    expect(r.opened).toBe(0);
    const [t] = store.trades();
    expect(t.exitReason).toBe("tp");
    expect(t.exitPrice).toBeCloseTo(104.05);
    expect(t.pnl).toBeGreaterThan(0);
    expect(t.closedAt).toBe(new Date(hit).toISOString());
    // Реализованный PnL учитывается в эпохе.
    expect((await store.realizedPnl(1)).A).toBeCloseTo(t.pnl ?? 0);
  });

  it("свеча задела и стоп, и тейк — засчитывается стоп", async () => {
    const hit = T0 + 2 * MIN;
    const m = market(["BTCUSDT"], (t) =>
      t === hit ? { high: 105, low: 95 } : {},
    );
    const store = enabledStore([exp("A")]);
    await runTick(m.deps(store), T0);
    m.setNow(T0 + 4 * MIN);
    await runTick(m.deps(store), T0 + 4 * MIN);
    const [t] = store.trades();
    expect(t.exitReason).toBe("sl");
    expect(t.pnl).toBeLessThan(0);
  });

  it("без выхода сдвигает checkedUntil и не трогает 1m-свечи до входа", async () => {
    // Касание стопа в минуту входа (до него) не должно закрыть сделку.
    const m = market(["BTCUSDT"], (t) => (t === T0 ? { low: 90 } : {}));
    const store = enabledStore([exp("A")]);
    await runTick(m.deps(store), T0);
    m.setNow(T0 + 3 * MIN);
    await runTick(m.deps(store), T0 + 3 * MIN);
    const [t] = store.trades();
    expect(t.closedAt).toBeNull();
    expect(t.checkedUntil).toBe(T0 + 3 * MIN);
  });

  it("выход по сигналу стратегии на закрытии свечи TF", async () => {
    // momentum: символ выпал из топ-K (topK = 0) → exit.long.
    const store = enabledStore([
      exp("M", {
        entry: { type: "momentum", lookbackBars: 3, topK: 1 },
        exit: {
          stop: { type: "atr", mult: 2 },
          takeProfit: null,
          exitOnSignal: true,
        },
        universe: { type: "top", n: 2 },
      }),
    ]);
    const m = market(["BTCUSDT", "ETHUSDT"]);
    expect((await runTick(m.deps(store), T0)).opened).toBe(1);
    // Через час юниверс сужается до одного символа другим тикером — открытая позиция выбывает.
    const deps = m.deps(store);
    const tickers: MarketTicker[] = [
      {
        symbol: "ETHUSDT",
        lastPrice: 100,
        priceChangePercent: 0,
        quoteVolume: 2e9,
      },
      {
        symbol: "BTCUSDT",
        lastPrice: 100,
        priceChangePercent: 0,
        quoteVolume: 1e9,
      },
    ];
    m.setNow(T0 + HOUR);
    const r = await runTick(
      { ...deps, tickers: async () => tickers },
      T0 + HOUR,
    );
    const btc = store.trades().find((t) => t.symbol === "BTCUSDT");
    expect(btc?.exitReason).toBe("signal");
    expect(r.closed).toBe(1);
    expect(r.opened).toBe(1);
  });
});

describe("runTick: кэш свечей", () => {
  it("один фетч на (market, symbol, tf) за тик и дозагрузка хвоста из кэша", async () => {
    const store = enabledStore([exp("A"), exp("B")]);
    const m = market();
    const deps = m.deps(store);
    await runTick(deps, T0);
    const first = m.calls.filter((c) => c.interval === "1h");
    expect(first).toHaveLength(1);
    expect(first[0].limit).toBeGreaterThan(200);
    m.setNow(T0 + HOUR);
    await runTick(deps, T0 + HOUR);
    const second = m.calls.filter((c) => c.interval === "1h").slice(1);
    expect(second).toHaveLength(1);
    expect(second[0].limit).toBeLessThan(20);
  });
});
