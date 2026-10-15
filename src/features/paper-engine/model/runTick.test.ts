import type {
  Candle,
  Experiment,
  ExperimentConfig,
  SkipReason,
} from "@binance-dashboard/trading-core";
import { exitFill, TIMEFRAME_MS } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { ENGINE } from "../config/engine.ts";
import type { MarketTicker } from "../lib/universe.ts";
import { createMemoryStore } from "./memoryStore.ts";
import { planReset, priceKey } from "./planReset.ts";
import {
  capSkipped,
  type Interval,
  runTick,
  type TickDeps,
} from "./runTick.ts";
import { ENGINE_KEYS } from "./store.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
// Начало часа: 1h-свеча 11:00 только что закрылась (свежий сигнал), свеча 12:00 — незакрыта.
const T0 = Date.parse("2026-10-10T12:00:00Z");

const exp = (
  id: string,
  patch: Partial<ExperimentConfig> = {},
  market: Experiment["market"] = "usdm",
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
 * minute(openTime) меняет отдельные 1m-свечи (касание стопа/тейка), bar — свечи остальных TF.
 */
function market(
  symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  minute: (openTime: number) => Partial<Candle> = () => ({}),
  bar: (
    symbol: string,
    interval: Interval,
    openTime: number,
    current: number,
  ) => Partial<Candle> = () => ({}),
) {
  const calls: {
    symbol: string;
    interval: Interval;
    limit: number;
    startTime?: number;
  }[] = [];
  let now = T0;
  // Как Binance: без startTime — последние limit свечей, со startTime — до limit свечей от него,
  // но не дальше текущей (незакрытой); больше 1000 за запрос не отдаёт.
  const candles = async (
    _m: Parameters<TickDeps["candles"]>[0],
    symbol: string,
    interval: Interval,
    limit: number,
    startTime?: number,
  ): Promise<Candle[]> => {
    calls.push({ symbol, interval, limit, startTime });
    const ms = MS[interval];
    const current = Math.floor(now / ms) * ms;
    const size = Math.min(limit, 1000);
    const first =
      startTime === undefined
        ? current - (size - 1) * ms
        : Math.ceil(startTime / ms) * ms;
    const length = Math.max(0, Math.min(size, (current - first) / ms + 1));
    return Array.from({ length }, (_, i) => {
      const openTime = first + i * ms;
      return {
        openTime,
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100,
        volume: 1,
        ...(interval === "1m"
          ? minute(openTime)
          : bar(symbol, interval, openTime, current)),
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
  it("открывает сделку по закрытой свече: слиппедж, стоп 2 ATR, TP 2R, объём $50", async () => {
    const store = enabledStore([exp("A")]);
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(1);
    const [t] = store.trades();
    expect(t.symbol).toBe("BTCUSDT");
    expect(t.direction).toBe("long");
    expect(t.entryPrice).toBeCloseTo(100.05);
    expect(t.initialStop).toBeCloseTo(98.05);
    expect(t.takeProfit).toBeCloseTo(104.05);
    // Фиксированный объём сделки $50 (ENGINE.tradeNotionalUsd).
    expect(t.quantity * t.entryPrice).toBeCloseTo(50);
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

describe("runTick: фильтры режима рынка и часов (spec 0029)", () => {
  const H4 = TIMEFRAME_MS["4h"];
  /** BTC на 4h: рост (close = 100 + номер свечи) или падение; незакрытая свеча — отдельно. */
  const btc4h =
    (trend: "up" | "down", unclosedClose?: number) =>
    (symbol: string, interval: Interval, openTime: number, current: number) => {
      if (symbol !== "BTCUSDT" || interval !== "4h") return {};
      if (openTime === current && unclosedClose !== undefined)
        return { close: unclosedClose };
      const i = openTime / H4 - Math.floor(T0 / H4);
      const close = trend === "up" ? 1000 + i : 1000 - i;
      return { open: close, high: close + 1, low: close - 1, close };
    };
  const regime = {
    marketFilter: {
      symbol: "BTCUSDT",
      timeframe: "4h",
      ema: 50,
      long: "above",
      short: "below",
    },
  } satisfies Partial<ExperimentConfig>;
  const eth = {
    universe: { type: "symbols", symbols: ["ETHUSDT"] },
  } satisfies Partial<ExperimentConfig>;

  it("long — только когда BTC выше EMA на старшем TF", async () => {
    const up = enabledStore([exp("A", { ...ALWAYS_LONG, ...eth, ...regime })]);
    expect(
      (await runTick(market(undefined, undefined, btc4h("up")).deps(up), T0))
        .opened,
    ).toBe(1);
    const down = enabledStore([
      exp("A", { ...ALWAYS_LONG, ...eth, ...regime }),
    ]);
    expect(
      (
        await runTick(
          market(undefined, undefined, btc4h("down")).deps(down),
          T0,
        )
      ).opened,
    ).toBe(0);
  });

  it("незакрытая свеча BTC не учитывается: скачок в текущей 4h-свече не открывает long", async () => {
    const store = enabledStore([
      exp("A", { ...ALWAYS_LONG, ...eth, ...regime }),
    ]);
    const m = market(undefined, undefined, btc4h("down", 5000));
    expect((await runTick(m.deps(store), T0)).opened).toBe(0);
  });

  it("свечи BTC режима — один запрос на TF за тик для всех экспериментов", async () => {
    const store = enabledStore([
      exp("A", { ...ALWAYS_LONG, ...eth, ...regime }),
      exp("B", {
        ...ALWAYS_LONG,
        universe: { type: "symbols", symbols: ["ETHUSDT", "SOLUSDT"] },
        ...regime,
      }),
    ]);
    const m = market(undefined, undefined, btc4h("up"));
    const r = await runTick(m.deps(store), T0);
    expect(r.opened).toBe(3);
    expect(
      m.calls.filter((c) => c.symbol === "BTCUSDT" && c.interval === "4h"),
    ).toHaveLength(1);
  });

  it("нет данных BTC — входа нет, одна ошибка тика на (символ, TF), а не на эксперимент", async () => {
    const store = enabledStore([
      exp("A", { ...ALWAYS_LONG, ...eth, ...regime }),
      exp("B", { ...ALWAYS_LONG, ...eth, ...regime }),
    ]);
    const m = market();
    const deps = m.deps(store);
    const r = await runTick(
      {
        ...deps,
        candles: (mk, symbol, interval, limit, startTime) =>
          symbol === "BTCUSDT" && interval === "4h"
            ? Promise.reject(new Error("нет сети"))
            : deps.candles(mk, symbol, interval, limit, startTime),
      },
      T0,
    );
    expect(r.opened).toBe(0);
    expect(r.errors.filter((e) => e.includes("режим рынка"))).toEqual([
      "режим рынка usdm BTCUSDT 4h: нет сети",
    ]);
  });

  it("истории BTC меньше периода EMA — входа нет, ошибка «мало свечей режима» один раз", async () => {
    const store = enabledStore([
      exp("A", { ...ALWAYS_LONG, ...eth, ...regime }),
      exp("B", { ...ALWAYS_LONG, ...eth, ...regime }),
    ]);
    const m = market(undefined, undefined, btc4h("up"));
    const deps = m.deps(store);
    const r = await runTick(
      {
        ...deps,
        // Binance отдал только 21 свечу (новый листинг): 20 закрытых при EMA(50).
        candles: (mk, symbol, interval, limit, startTime) =>
          deps.candles(
            mk,
            symbol,
            interval,
            symbol === "BTCUSDT" && interval === "4h" ? 21 : limit,
            startTime,
          ),
      },
      T0,
    );
    expect(r.opened).toBe(0);
    expect(r.errors.filter((e) => e.includes("режим рынка"))).toEqual([
      "режим рынка usdm BTCUSDT 4h: мало свечей режима: 20 из 50",
    ]);
  });

  it("строка эксперимента не прошла схему — тик идёт для остальных, ошибка с id и путём поля", async () => {
    const base = enabledStore([exp("A")]);
    const store: TickDeps["store"] = {
      ...base,
      listExperiments: async (onInvalid) => {
        onInvalid?.({ id: "BAD", problem: "config.marketFiltr — лишнее поле" });
        return base.listExperiments();
      },
    };
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(1);
    expect(r.errors).toEqual([
      "эксперимент BAD пропущен: конфиг не проходит схему: config.marketFiltr — лишнее поле",
    ]);
  });

  it("часы UTC: вне окна входа нет, окно через полночь пропускает", async () => {
    // T0 — суббота 12:00 UTC.
    const outside = enabledStore([
      exp("A", { sessionFilter: { hoursUtc: [13, 20] } }),
    ]);
    expect((await runTick(market().deps(outside), T0)).opened).toBe(0);
    const overnight = enabledStore([
      exp("A", { sessionFilter: { hoursUtc: [22, 13], days: [6] } }),
    ]);
    expect((await runTick(market().deps(overnight), T0)).opened).toBe(1);
    const weekdays = enabledStore([
      exp("A", { sessionFilter: { days: [1, 2, 3, 4, 5] } }),
    ]);
    expect((await runTick(market().deps(weekdays), T0)).opened).toBe(0);
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

  it("после простоя 1500 минут закрывает по стопу, задетому на 300-й минуте простоя (баг 0028)", async () => {
    // Стоп long ≈ 98,05: на 300-й минуте простоя свеча проваливается до 97, потом цена возвращается.
    const hit = T0 + 300 * MIN;
    const m = market(["BTCUSDT"], (t) => (t === hit ? { low: 97 } : {}));
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    expect((await runTick(m.deps(store), T0)).opened).toBe(1);
    const [opened] = store.trades();
    const later = T0 + 1500 * MIN;
    m.setNow(later);
    const r = await runTick(m.deps(store), later);
    expect(r.closed).toBe(1);
    const t = store.trades().find((x) => x.id === opened.id);
    expect(t?.exitReason).toBe("sl");
    expect(t?.closedAt).toBe(new Date(hit).toISOString());
    expect(t?.exitPrice).toBeCloseTo(
      exitFill(opened.initialStop ?? 0, "long", "sl"),
    );
  });

  it("разрыв ≤ 1000 минут — одна страница 1m-свечей от checkedUntil", async () => {
    const m = market(["BTCUSDT"]);
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    await runTick(m.deps(store), T0);
    const [opened] = store.trades();
    const later = T0 + 1000 * MIN;
    m.setNow(later);
    const before = m.calls.length;
    await runTick(m.deps(store), later);
    const minuteCalls = m.calls
      .slice(before)
      .filter((c) => c.interval === "1m");
    expect(minuteCalls).toHaveLength(1);
    expect(minuteCalls[0].startTime).toBe(opened.checkedUntil);
    // Незакрытая минута отброшена: проверено всё до текущей минуты.
    const t = store.trades().find((x) => x.id === opened.id);
    expect(t?.checkedUntil).toBe(later);
  });

  it("долгий простой — не больше maxMinutePages страниц за тик, warn и догрузка следующими тиками", async () => {
    // Стоп задет на 5000-й минуте простоя — дальше, чем дочитывает один тик (3 × 1000 минут).
    const hit = T0 + 5000 * MIN;
    const m = market(["BTCUSDT"], (t) => (t === hit ? { low: 97 } : {}));
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    await runTick(m.deps(store), T0);
    const [opened] = store.trades();
    const logs: { level: string; event: string; data?: unknown }[] = [];
    const log: TickDeps["log"] = (level, event, _message, data) => {
      logs.push({ level, event, data });
    };
    const later = T0 + 7 * 24 * HOUR;
    m.setNow(later);

    const before = m.calls.length;
    const r1 = await runTick({ ...m.deps(store), log }, later);
    const pages = m.calls.slice(before).filter((c) => c.interval === "1m");
    expect(pages).toHaveLength(ENGINE.maxMinutePages);
    expect(pages.map((c) => c.startTime)).toEqual([
      T0 + MIN,
      T0 + 1001 * MIN,
      T0 + 2001 * MIN,
    ]);
    expect(r1.closed).toBe(0);
    const progressed = store.trades().find((x) => x.id === opened.id);
    expect(progressed?.checkedUntil).toBe(T0 + 3001 * MIN);
    const gap = logs.find((l) => l.event === "engine.minute-gap");
    expect(gap?.level).toBe("warn");
    expect(gap?.data).toMatchObject({
      symbol: "BTCUSDT",
      gapMinutes: 7 * 24 * 60 - 1,
    });

    // Следующий тик продолжает с прочитанного и находит стоп по той свече, где он был задет.
    const next = later + MIN;
    m.setNow(next);
    const r2 = await runTick({ ...m.deps(store), log }, next);
    expect(r2.closed).toBe(1);
    const t = store.trades().find((x) => x.id === opened.id);
    expect(t?.exitReason).toBe("sl");
    expect(t?.closedAt).toBe(new Date(hit).toISOString());
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

describe("runTick: выключенный эксперимент и сброс эпохи (задача 3d)", () => {
  const LONG = ALWAYS_LONG;

  it("enabled=false — новых сделок нет, свеча не обрабатывается", async () => {
    const store = enabledStore([{ ...exp("A", LONG), enabled: false }]);
    const r = await runTick(market().deps(store), T0);
    expect(r.opened).toBe(0);
    expect(r.evaluated).toEqual([]);
    expect(store.trades()).toHaveLength(0);
  });

  it("выключенный эксперимент доводит открытую сделку до выхода", async () => {
    const experiments = [exp("A", LONG)];
    const store = enabledStore(experiments);
    // Стоп long ≈ 98,05: 1m-свеча 12:01 проваливается до 97.
    const m = market(["BTCUSDT"], (t) => (t === T0 + MIN ? { low: 97 } : {}));
    expect((await runTick(m.deps(store), T0)).opened).toBe(1);
    experiments[0].enabled = false;
    m.setNow(T0 + 3 * MIN);
    const r = await runTick(m.deps(store), T0 + 3 * MIN);
    expect(r.closed).toBe(1);
    expect(store.trades()[0].exitReason).toBe("sl");
  });

  it("после сброса с метками planReset новая эпоха не входит по свече до сброса", async () => {
    const experiments = [exp("A", LONG)];
    const store = enabledStore(experiments);
    const m = market(["BTCUSDT"]);
    expect((await runTick(m.deps(store), T0)).opened).toBe(1);

    const now = T0 + MIN;
    const plan = planReset({
      experiments,
      open: store.trades().filter((t) => t.closedAt === null),
      prices: { [priceKey("usdm", "BTCUSDT")]: 101 },
      now,
    });
    for (const c of plan.closes) await store.closeTrade(c.id, c.close);
    store.newRun();
    await store.setState(ENGINE_KEYS.bars, plan.bars);

    m.setNow(now);
    const r = await runTick(m.deps(store), now);
    expect(r.opened).toBe(0);
    expect(r.evaluated).toEqual([]);
    // Следующая свеча TF — уже сигнал новой эпохи.
    m.setNow(T0 + HOUR);
    const next = await runTick(m.deps(store), T0 + HOUR);
    expect(next.opened).toBe(1);
    expect(store.trades().at(-1)?.runId).toBe(2);
  });
});

describe("runTick: контекст входа, MAE и отсечённые сигналы (spec 0030)", () => {
  it("сделка хранит снимок рынка на входе: место в юниверсе, BTC 4h, funding, час и день", async () => {
    const store = enabledStore([
      exp("A", { ...ALWAYS_LONG, universe: { type: "top", n: 3 }, maxOpen: 1 }),
    ]);
    const m = market();
    const groups: string[] = [];
    const deps = {
      ...m.deps(store),
      funding: async (group: Experiment["market"]) => {
        groups.push(group);
        return { BTCUSDT: 1e-4 };
      },
    };
    await runTick(deps, T0);
    const [t] = store.trades();
    expect(t.entryContext).toMatchObject({
      v: 1,
      universeRank: 1,
      universeSize: 3,
      funding: 1e-4,
      hourUtc: 12,
      weekday: 6, // 2026-10-10 — суббота
      btcAboveEma200_4h: false, // ровная цена 100: close не выше EMA
    });
    expect(groups).toEqual(["usdm"]);
    // Ровный рынок: ATR = 1 при цене 100, объём свечи равен среднему.
    expect(t.entryContext.atrPct).toBeCloseTo(1);
    expect(t.entryContext.volumeRatio).toBe(1);
    expect(t.mae).toBe(t.entryPrice);
    // Свечи BTC 4h для контекста — тем же запросом, что и свечи сигналов (кэш), один раз за тик.
    expect(
      m.calls.filter((c) => c.symbol === "BTCUSDT" && c.interval === "4h"),
    ).toHaveLength(1);
  });

  it("spot: funding в контексте — null, запрос funding не делается", async () => {
    const store = enabledStore([exp("S", ALWAYS_LONG, "spot")]);
    let fundingCalls = 0;
    const deps = {
      ...market().deps(store),
      funding: async () => {
        fundingCalls++;
        return { BTCUSDT: 1e-4 };
      },
    };
    await runTick(deps, T0);
    expect(store.trades()[0].entryContext.funding).toBeNull();
    expect(fundingCalls).toBe(0);
  });

  it("сбой свечей BTC и funding не мешает входу: поля контекста null", async () => {
    const store = enabledStore([
      exp("A", {
        ...ALWAYS_LONG,
        universe: { type: "symbols", symbols: ["ETHUSDT"] },
      }),
    ]);
    const base = market(["ETHUSDT"]).deps(store);
    const deps: TickDeps = {
      ...base,
      candles: (mk, symbol, interval, limit, start) =>
        symbol === "BTCUSDT"
          ? Promise.reject(new Error("нет сети"))
          : base.candles(mk, symbol, interval, limit, start),
      funding: () => Promise.reject(new Error("нет сети")),
    };
    const r = await runTick(deps, T0);
    expect(r.opened).toBe(1);
    expect(store.trades()[0].entryContext).toMatchObject({
      btcAboveEma200_4h: null,
      btcAdx14_4h: null,
      funding: null,
    });
  });

  it("MAE: проход выходов сохраняет худшую цену, закрытие — со свечой выхода", async () => {
    const m = market(["BTCUSDT"], (t) => {
      if (t === T0 + MIN) return { low: 99.1 };
      if (t === T0 + 3 * MIN) return { high: 105, low: 98.9 };
      return {};
    });
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    await runTick(m.deps(store), T0);
    m.setNow(T0 + 2 * MIN);
    await runTick(m.deps(store), T0 + 2 * MIN);
    expect(store.trades()[0].mae).toBe(99.1);
    m.setNow(T0 + 5 * MIN);
    await runTick(m.deps(store), T0 + 5 * MIN);
    const [t] = store.trades();
    expect(t.exitReason).toBe("tp");
    expect(t.mae).toBe(98.9);
  });

  it("сделка без MAE (до spec 0030) — MAE остаётся null", async () => {
    const m = market(["BTCUSDT"], (t) => (t === T0 + MIN ? { low: 99 } : {}));
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    await runTick(m.deps(store), T0);
    const [opened] = store.trades();
    await store.updateTrade(opened.id, {
      stop: opened.stop,
      extreme: opened.extreme,
      mae: null,
      checkedUntil: opened.checkedUntil,
    });
    m.setNow(T0 + 3 * MIN);
    await runTick(m.deps(store), T0 + 3 * MIN);
    expect(store.trades()[0].mae).toBeNull();
  });

  it("отсечённые сигналы: лимит позиций и занятый символ — с ценой, стопом и тейком, которые были бы", async () => {
    const store = enabledStore([
      exp("A", { ...ALWAYS_LONG, universe: { type: "top", n: 3 }, maxOpen: 2 }),
    ]);
    const m = market();
    await runTick(m.deps(store), T0);
    expect(store.trades()).toHaveLength(2);
    const [skip] = store.skipped();
    expect(skip).toMatchObject({
      runId: 1,
      experimentId: "A",
      market: "usdm",
      symbol: "SOLUSDT",
      direction: "long",
      bar: T0 - HOUR,
      at: new Date(T0).toISOString(),
      reason: "max-open",
    });
    expect(skip.entryPrice).toBeCloseTo(100.05);
    expect(skip.stop).toBeCloseTo(98.05);
    expect(skip.takeProfit).toBeCloseTo(104.05);

    // Следующая свеча: BTC и ETH уже в позиции у эксперимента, SOL — лимит.
    m.setNow(T0 + HOUR);
    await runTick(m.deps(store), T0 + HOUR);
    expect(
      store
        .skipped()
        .filter((s) => s.bar === T0)
        .map((s) => `${s.symbol}:${s.reason}`)
        .sort(),
    ).toEqual(["BTCUSDT:max-open", "ETHUSDT:max-open", "SOLUSDT:max-open"]);
  });

  it("занятый символ при свободном лимите — symbol-busy; повтор тика не дублирует", async () => {
    const store = enabledStore([exp("A", ALWAYS_LONG)]);
    const m = market(["BTCUSDT"]);
    await runTick(m.deps(store), T0);
    m.setNow(T0 + HOUR);
    await runTick(m.deps(store), T0 + HOUR);
    await runTick(m.deps(store), T0 + HOUR);
    expect(store.skipped().map((s) => s.reason)).toEqual(["symbol-busy"]);
  });

  it("нет свободных денег — no-budget", async () => {
    const store = enabledStore([
      { ...exp("A", ALWAYS_LONG), initialBudget: 4 },
    ]);
    const r = await runTick(market(["BTCUSDT"]).deps(store), T0);
    expect(r.opened).toBe(0);
    expect(store.skipped().map((s) => s.reason)).toEqual(["no-budget"]);
  });

  it("фильтр отсёк сигнал — это не отсечённый лимитом сигнал; hold не пишет занятость", async () => {
    const trend = enabledStore([
      exp("A", {
        ...ALWAYS_LONG,
        maxOpen: 1,
        trendFilter: { timeframe: "4h", period: 50 },
      }),
    ]);
    await runTick(market().deps(trend), T0);
    expect(trend.skipped()).toEqual([]);

    const hold = enabledStore([exp("H")]);
    const m = market(["BTCUSDT"]);
    await runTick(m.deps(hold), T0);
    m.setNow(T0 + HOUR);
    await runTick(m.deps(hold), T0 + HOUR);
    expect(hold.skipped()).toEqual([]);
  });

  it("объём ограничен: не больше skippedSignalsCap на (эпоха, эксперимент, причина)", () => {
    const row = (id: string, experimentId: string, reason: SkipReason) => ({
      id,
      runId: 1,
      experimentId,
      market: "usdm" as const,
      symbol: "BTCUSDT",
      direction: "long" as const,
      bar: 0,
      at: new Date(T0).toISOString(),
      reason,
      entryPrice: 100,
      stop: 98,
      takeProfit: null,
    });
    const rows = [
      row("1", "A", "max-open"),
      row("2", "A", "max-open"),
      row("3", "A", "max-open"),
      row("4", "A", "symbol-busy"),
      row("5", "B", "max-open"),
    ];
    const kept = capSkipped(
      rows,
      [
        { experimentId: "A", reason: "max-open", count: 2 },
        { experimentId: "B", reason: "max-open", count: 3 },
      ],
      3,
    );
    expect(kept.map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("лимит и срок хранения применяются в тике", async () => {
    const store = enabledStore([
      exp("A", {
        ...ALWAYS_LONG,
        universe: { type: "top", n: 3 },
        maxOpen: 1,
      }),
    ]);
    const old = {
      id: "old",
      runId: 1,
      experimentId: "A",
      market: "usdm" as const,
      symbol: "XRPUSDT",
      direction: "long" as const,
      bar: 0,
      at: new Date(
        T0 - (ENGINE.skippedSignalsRetentionDays + 1) * 24 * HOUR,
      ).toISOString(),
      reason: "symbol-busy" as const,
      entryPrice: 1,
      stop: null,
      takeProfit: null,
    };
    const filler = Array.from(
      { length: ENGINE.skippedSignalsCap - 1 },
      (_, i) => ({
        ...old,
        id: `f${i}`,
        reason: "max-open" as const,
        at: new Date(T0 - HOUR).toISOString(),
      }),
    );
    await store.insertSkippedSignals([old, ...filler]);
    await runTick(market().deps(store), T0);
    const skipped = store.skipped();
    // Из двух отсечённых в тике (ETH, SOL) в лимит влез один; старая запись удалена.
    expect(skipped.filter((s) => s.reason === "max-open")).toHaveLength(
      ENGINE.skippedSignalsCap,
    );
    expect(skipped.some((s) => s.symbol === "ETHUSDT")).toBe(true);
    expect(skipped.some((s) => s.symbol === "SOLUSDT")).toBe(false);
    expect(skipped.some((s) => s.id === "old")).toBe(false);
  });
});

describe("runTick: сбой свечей фильтра тренда (ревью 0030)", () => {
  it("ошибка загрузки свечей старшего TF — вход по символу запрещён, остальные символы обрабатываются, одна ошибка на ключ", async () => {
    const trend = {
      ...ALWAYS_LONG,
      universe: { type: "top", n: 3 },
      trendFilter: { timeframe: "4h", period: 50 },
    } satisfies Partial<ExperimentConfig>;
    const store = enabledStore([exp("A", trend), exp("B", trend)]);
    // Старший TF ниже цены (close 90) — тренд разрешает long; у ETH свечи 4h не грузятся.
    const base = market(undefined, undefined, (_s, interval) =>
      interval === "4h" ? { open: 90, high: 90.5, low: 89.5, close: 90 } : {},
    ).deps(store);
    const deps: TickDeps = {
      ...base,
      candles: (mk, symbol, interval, limit, start) =>
        symbol === "ETHUSDT" && interval === "4h"
          ? Promise.reject(new Error("нет сети"))
          : base.candles(mk, symbol, interval, limit, start),
    };
    const r = await runTick(deps, T0);
    expect(r.evaluated).toEqual(["A", "B"]);
    expect(r.opened).toBe(4);
    expect(store.trades().some((t) => t.symbol === "ETHUSDT")).toBe(false);
    expect(r.errors.filter((e) => e.startsWith("тренд"))).toEqual([
      "тренд usdm ETHUSDT 4h: нет сети",
    ]);
  });
});

describe("runTick: COIN-M (spec 0023)", () => {
  const coinmExp = (id: string, patch: Partial<ExperimentConfig> = {}) =>
    exp(
      id,
      { universe: { type: "symbols", symbols: ["BTC"] }, ...patch },
      "coinm",
    );

  /** Рынок COIN-M поверх синтетических свечей: тикеры с размером контракта, по группам. */
  function coinmMarket(opts: { coinmDown?: boolean } = {}) {
    const m = market(["BTCUSDT"]);
    const funding: string[] = [];
    const logs: string[] = [];
    const deps = (store: TickDeps["store"]): TickDeps => ({
      ...m.deps(store),
      tickers: async (group) => {
        if (group !== "coinm")
          return [
            {
              symbol: "BTCUSDT",
              lastPrice: 100,
              priceChangePercent: 0,
              quoteVolume: 1e9,
            },
          ];
        if (opts.coinmDown) throw new Error("dapi недоступен");
        return [
          {
            symbol: "BTCUSD_PERP",
            lastPrice: 100,
            priceChangePercent: 0,
            quoteVolume: 1e9,
            contractSize: 10,
          },
        ];
      },
      funding: async (group) => {
        funding.push(group);
        return {};
      },
      log: (level, _event, message) => logs.push(`${level}: ${message}`),
    });
    return { m, funding, logs, deps };
  }

  it("входит целыми контрактами: floor($50 / $10) = 5 контрактов, qty = 5 × 10 / вход", async () => {
    const store = enabledStore([coinmExp("C")]);
    const r = await runTick(coinmMarket().deps(store), T0);
    expect(r.opened).toBe(1);
    const [t] = store.trades();
    expect(t.market).toBe("coinm");
    expect(t.symbol).toBe("BTCUSD_PERP");
    expect(t.quantity * t.entryPrice).toBeCloseTo(50);
    expect(t.fees).toBeCloseTo(0.0005 * 50);
  });

  it("шорт разрешён, как у USDⓈ-M (у Spot тот же конфиг не входит)", async () => {
    // Случайный вход: половина экспериментов получает short — у COIN-M они входят.
    const ids = Array.from({ length: 10 }, (_, i) => `C${i}`);
    const store = enabledStore(
      ids.map((id) =>
        coinmExp(id, {
          entry: { type: "random", probability: 1 },
          directions: ["short"],
        }),
      ),
    );
    const r = await runTick(coinmMarket().deps(store), T0);
    expect(r.opened).toBeGreaterThan(0);
    expect(store.trades().every((t) => t.direction === "short")).toBe(true);
  });

  it("funding запрашивается по своей группе", async () => {
    const store = enabledStore([
      coinmExp("C", { entry: { type: "funding", threshold: 0.001 } }),
      exp("U", { entry: { type: "funding", threshold: 0.001 } }),
    ]);
    const cm = coinmMarket();
    await runTick(cm.deps(store), T0);
    expect([...cm.funding].sort()).toEqual(["coinm", "usdm"]);
  });

  it("режим рынка BTCUSDT у COIN-M читается по BTCUSD_PERP (свечи dapi)", async () => {
    const store = enabledStore([
      coinmExp("C", {
        marketFilter: {
          symbol: "BTCUSDT",
          timeframe: "4h",
          ema: 50,
          long: "any",
          short: "any",
        },
      }),
    ]);
    const cm = coinmMarket();
    await runTick(cm.deps(store), T0);
    const regime = cm.m.calls.filter((c) => c.interval === "4h");
    expect(regime.map((c) => c.symbol)).toEqual(["BTCUSD_PERP"]);
  });

  it("dapi недоступен: COIN-M пропускается одной записью warn, USDⓈ-M торгует", async () => {
    const store = enabledStore([coinmExp("C1"), coinmExp("C2"), exp("U")]);
    const cm = coinmMarket({ coinmDown: true });
    const r = await runTick(cm.deps(store), T0);
    expect(r.opened).toBe(1);
    expect(store.trades().map((t) => t.market)).toEqual(["usdm"]);
    expect(r.errors).toHaveLength(1);
    expect(cm.logs.filter((l) => l.startsWith("warn"))).toHaveLength(1);
    // Свеча COIN-M не помечена обработанной — следующий тик попробует снова.
    expect(r.evaluated).toEqual(["U"]);
  });

  it("контекст входа и отсечённые сигналы COIN-M (spec 0030): BTC 4h — BTCUSD_PERP, funding своей группы, market = coinm", async () => {
    const store = enabledStore([coinmExp("C", ALWAYS_LONG)]);
    const cm = coinmMarket();
    await runTick(cm.deps(store), T0);
    const [t] = store.trades();
    expect(t.entryContext).toMatchObject({
      universeRank: 1,
      universeSize: 1,
      btcAboveEma200_4h: false,
      funding: null, // в ставках группы символа нет
    });
    expect(cm.funding).toEqual(["coinm"]);
    expect(
      cm.m.calls.filter((c) => c.interval === "4h").map((c) => c.symbol),
    ).toEqual(["BTCUSD_PERP"]);
    cm.m.setNow(T0 + HOUR);
    await runTick(cm.deps(store), T0 + HOUR);
    expect(store.skipped()).toEqual([
      expect.objectContaining({
        market: "coinm",
        symbol: "BTCUSD_PERP",
        reason: "symbol-busy",
      }),
    ]);
  });
});
