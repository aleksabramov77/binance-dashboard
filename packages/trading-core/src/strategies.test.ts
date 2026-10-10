import { describe, expect, it } from "vitest";
import type { EntryRule } from "./experiment.ts";
import { macd, supertrend } from "./indicators/index.ts";
import { evaluateStrategy, type StrategyContext } from "./strategies.ts";
import type { Candle } from "./types.ts";

const bar = (close: number, patch: Partial<Candle> = {}): Candle => ({
  openTime: 0,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1,
  ...patch,
});
const series = (closes: number[]) => closes.map((c) => bar(c));
const range = (from: number, n: number, step: number) =>
  Array.from({ length: n }, (_, i) => from + i * step);
const zigzag = (n: number, a: number, b: number) =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b));

const ctx = (
  candles: Candle[],
  patch: Partial<StrategyContext> = {},
): StrategyContext => ({ candles, change24h: 0, random: 0.99, ...patch });
const run = (rule: EntryRule, c: StrategyContext) => evaluateStrategy(rule, c);

describe("evaluateStrategy: общее", () => {
  it("меньше двух свечей — нет сигнала", () => {
    expect(run({ type: "hold" }, ctx([bar(1)]))).toEqual({
      entry: null,
      exit: { long: false, short: false },
    });
  });
});

describe("counterTrend (сканер дашборда)", () => {
  const pumped = series([...new Array(60).fill(100), ...range(103, 10, 3)]);
  const dumped = series([...new Array(60).fill(100), ...range(97, 10, -3)]);

  it("шорт после пампа: стоп выше цены, цель ниже", () => {
    const r = run(
      { type: "counterTrend", mode: "overheat" },
      ctx(pumped, { change24h: 0.3 }),
    );
    expect(r.entry?.direction).toBe("short");
    expect(r.entry?.stop).toBeGreaterThan(130);
    expect(r.entry?.target).toBeLessThan(130);
  });

  it("отскок после падения → long; стоп ниже цены", () => {
    const r = run(
      { type: "counterTrend", mode: "both" },
      ctx(dumped, { change24h: -0.3 }),
    );
    expect(r.entry?.direction).toBe("long");
    expect(r.entry?.stop).toBeLessThan(70);
    expect(r.entry?.target).toBeGreaterThan(70);
  });

  it("продолжение пампа → long; режим rebound на пампе молчит", () => {
    const c = ctx(pumped, { change24h: 0.3 });
    expect(
      run({ type: "counterTrend", mode: "pumpContinuation" }, c).entry
        ?.direction,
    ).toBe("long");
    expect(run({ type: "counterTrend", mode: "rebound" }, c).entry).toBeNull();
  });

  it("без сильного изменения за 24 ч сигнала нет", () => {
    expect(
      run(
        { type: "counterTrend", mode: "both" },
        ctx(pumped, { change24h: 0.05 }),
      ).entry,
    ).toBeNull();
  });
});

describe("emaCross", () => {
  const rule: EntryRule = { type: "emaCross", fast: 3, slow: 5 };

  it("кросс вверх → long и выход из шорта", () => {
    const r = run(rule, ctx(series([...range(100, 30, -1), 90])));
    expect(r.entry?.direction).toBe("long");
    expect(r.exit).toEqual({ long: false, short: true });
  });

  it("кросс вниз → short", () => {
    const r = run(rule, ctx(series([...range(100, 30, 1), 110])));
    expect(r.entry?.direction).toBe("short");
    expect(r.exit.long).toBe(true);
  });

  it("тренд без пересечения — только флаг выхода", () => {
    const r = run(rule, ctx(series(range(100, 30, 1))));
    expect(r.entry).toBeNull();
    expect(r.exit).toEqual({ long: false, short: true });
  });
});

describe("donchian", () => {
  const flat = new Array(10).fill(100);

  it("пробой вверх → long со стопом у нижней границы", () => {
    const r = run({ type: "donchian", period: 5 }, ctx(series([...flat, 105])));
    expect(r.entry).toMatchObject({ direction: "long", stop: 99.5 });
  });

  it("пробой вниз → short со стопом у верхней границы", () => {
    const r = run({ type: "donchian", period: 5 }, ctx(series([...flat, 95])));
    expect(r.entry).toMatchObject({ direction: "short", stop: 100.5 });
    expect(r.exit.long).toBe(true);
  });

  it("фильтр объёма: без всплеска входа нет, со всплеском — есть", () => {
    const rule: EntryRule = { type: "donchian", period: 5, volumeMult: 2 };
    const candles = series([...new Array(25).fill(100), 105]);
    expect(run(rule, ctx(candles)).entry).toBeNull();
    candles[candles.length - 1] = bar(105, { volume: 3 });
    expect(run(rule, ctx(candles)).entry?.direction).toBe("long");
  });

  it("внутри канала сигнала нет", () => {
    expect(
      run({ type: "donchian", period: 5 }, ctx(series([...flat, 100]))).entry,
    ).toBeNull();
  });
});

describe("rsi2", () => {
  const rule: EntryRule = { type: "rsi2", threshold: 10, trendSma: 20 };

  it("перепроданность в аптренде → long с целью у SMA5", () => {
    const r = run(rule, ctx(series([...range(100, 30, 1), 127, 125, 123])));
    expect(r.entry?.direction).toBe("long");
    expect(r.entry?.target).toBeCloseTo((128 + 129 + 127 + 125 + 123) / 5);
  });

  it("перекупленность в даунтренде → short", () => {
    const r = run(rule, ctx(series([...range(200, 30, -1), 173, 175, 177])));
    expect(r.entry?.direction).toBe("short");
  });

  it("нет экстремума RSI — выход лонга выше SMA5", () => {
    const r = run(rule, ctx(series(range(100, 30, 1))));
    expect(r.entry).toBeNull();
    expect(r.exit).toEqual({ long: true, short: false });
  });
});

describe("bbReversion", () => {
  const rule: EntryRule = { type: "bbReversion", rsiMax: 30 };

  it("прокол нижней полосы при низком RSI → long к средней линии", () => {
    const r = run(rule, ctx(series([...zigzag(30, 100, 101), 96, 92, 88])));
    expect(r.entry?.direction).toBe("long");
    expect(r.entry?.target).toBeGreaterThan(88);
  });

  it("прокол верхней полосы при высоком RSI → short", () => {
    const r = run(rule, ctx(series([...zigzag(30, 100, 101), 105, 109, 113])));
    expect(r.entry?.direction).toBe("short");
    expect(r.entry?.target).toBeLessThan(113);
  });

  it("цена внутри полос — сигнала нет", () => {
    expect(run(rule, ctx(series(zigzag(30, 100, 101)))).entry).toBeNull();
  });
});

describe("bbSqueeze", () => {
  const rule: EntryRule = { type: "bbSqueeze", maxWidth: 0.02 };
  const calm = zigzag(30, 100, 100.2);

  it("пробой после сжатия вверх → long, вниз → short", () => {
    expect(run(rule, ctx(series([...calm, 103]))).entry?.direction).toBe(
      "long",
    );
    expect(run(rule, ctx(series([...calm, 97]))).entry?.direction).toBe(
      "short",
    );
  });

  it("без сжатия пробой не считается", () => {
    const wide = zigzag(30, 90, 110);
    expect(
      run({ type: "bbSqueeze", maxWidth: 0.01 }, ctx(series([...wide, 130])))
        .entry,
    ).toBeNull();
  });
});

describe("macd", () => {
  const closes = [...range(200, 60, -1), ...range(141, 40, 2)];
  const hist = macd(closes).hist;
  const crossAt = hist.findIndex((v, i) => i > 0 && hist[i - 1] <= 0 && v > 0);
  const upTo = series(closes.slice(0, crossAt + 1));

  it("гистограмма пересекла ноль вверх → long", () => {
    expect(crossAt).toBeGreaterThan(0);
    const r = run({ type: "macd" }, ctx(upTo));
    expect(r.entry?.direction).toBe("long");
    expect(r.exit.short).toBe(true);
  });

  it("гистограмма пересекла ноль вниз → short", () => {
    const down = closes.map((c) => 400 - c);
    const h = macd(down).hist;
    const at = h.findIndex((v, i) => i > 0 && h[i - 1] >= 0 && v < 0);
    expect(
      run({ type: "macd" }, ctx(series(down.slice(0, at + 1)))).entry
        ?.direction,
    ).toBe("short");
  });

  it("ADX ниже порога блокирует вход", () => {
    expect(run({ type: "macd", minAdx: 101 }, ctx(upTo)).entry).toBeNull();
  });
});

describe("supertrend", () => {
  const rule: EntryRule = { type: "supertrend", period: 10, mult: 3 };
  const candles = series([...range(200, 40, -1), ...range(161, 40, 2)]);
  const dir = supertrend(candles, 10, 3).dir;
  const flipAt = dir.findIndex((d, i) => i > 0 && dir[i - 1] === -1 && d === 1);

  it("разворот вверх → long со стопом на линии", () => {
    expect(flipAt).toBeGreaterThan(0);
    const r = run(rule, ctx(candles.slice(0, flipAt + 1)));
    expect(r.entry?.direction).toBe("long");
    expect(r.entry?.stop).toBeLessThan(candles[flipAt].close);
    expect(r.exit).toEqual({ long: false, short: true });
  });

  it("без разворота — только флаг выхода", () => {
    const r = run(rule, ctx(candles));
    expect(r.entry).toBeNull();
    expect(r.exit.short).toBe(true);
  });
});

describe("volumeSpike", () => {
  const rule: EntryRule = { type: "volumeSpike", mult: 3 };
  const base = series(new Array(25).fill(100));
  const withLast = (c: Candle) => ctx([...base, c]);

  it("всплеск и закрытие у максимума → long, у минимума → short", () => {
    expect(
      run(rule, withLast(bar(101.9, { high: 102, low: 99, volume: 5 }))).entry
        ?.direction,
    ).toBe("long");
    expect(
      run(rule, withLast(bar(99.1, { high: 102, low: 99, volume: 5 }))).entry
        ?.direction,
    ).toBe("short");
  });

  it("объём ниже порога или закрытие в середине — нет сигнала", () => {
    expect(
      run(rule, withLast(bar(101.9, { high: 102, low: 99, volume: 2 }))).entry,
    ).toBeNull();
    expect(
      run(rule, withLast(bar(100.5, { high: 102, low: 99, volume: 5 }))).entry,
    ).toBeNull();
  });
});

describe("emaPullback", () => {
  const up = range(100, 250, 1);
  const down = range(400, 250, -1);

  it("касание EMA20 в аптренде → long", () => {
    const last = up.at(-1) ?? 0;
    const candles = [...series(up), bar(last, { low: last - 15 })];
    expect(run({ type: "emaPullback" }, ctx(candles)).entry?.direction).toBe(
      "long",
    );
  });

  it("касание EMA20 в даунтренде → short", () => {
    const last = down.at(-1) ?? 0;
    const candles = [...series(down), bar(last, { high: last + 15 })];
    expect(run({ type: "emaPullback" }, ctx(candles)).entry?.direction).toBe(
      "short",
    );
  });

  it("тренд без отката — нет сигнала", () => {
    expect(run({ type: "emaPullback" }, ctx(series(up))).entry).toBeNull();
  });
});

describe("momentum", () => {
  const rule: EntryRule = { type: "momentum", lookbackBars: 42, topK: 3 };
  const candles = series(range(100, 10, 1));

  it("в топе → long; выпал из топа → выход", () => {
    expect(run(rule, ctx(candles, { momentumRank: 0 })).entry?.direction).toBe(
      "long",
    );
    const out = run(rule, ctx(candles, { momentumRank: 5 }));
    expect(out.entry).toBeNull();
    expect(out.exit.long).toBe(true);
  });

  it("без рейтинга сигнала нет", () => {
    expect(run(rule, ctx(candles)).entry).toBeNull();
  });
});

describe("random и hold (контроль)", () => {
  const candles = series(range(100, 10, 1));
  const rule: EntryRule = { type: "random", probability: 0.1 };

  it("random: вход с заданной вероятностью, направление по числу", () => {
    expect(run(rule, ctx(candles, { random: 0.02 })).entry?.direction).toBe(
      "long",
    );
    expect(run(rule, ctx(candles, { random: 0.07 })).entry?.direction).toBe(
      "short",
    );
    expect(run(rule, ctx(candles, { random: 0.5 })).entry).toBeNull();
  });

  it("hold: всегда long, выхода по сигналу нет", () => {
    expect(run({ type: "hold" }, ctx(candles))).toMatchObject({
      entry: { direction: "long" },
      exit: { long: false, short: false },
    });
  });
});

describe("funding", () => {
  const rule: EntryRule = { type: "funding", threshold: 0.0005 };

  it("высокий funding ниже EMA50 → short", () => {
    const c = ctx(series(range(200, 60, -1)), { funding: 0.001 });
    expect(run(rule, c).entry?.direction).toBe("short");
  });

  it("отрицательный funding выше EMA50 → long", () => {
    const c = ctx(series(range(100, 60, 1)), { funding: -0.001 });
    expect(run(rule, c).entry?.direction).toBe("long");
  });

  it("без funding или против тренда — нет сигнала", () => {
    expect(run(rule, ctx(series(range(100, 60, 1)))).entry).toBeNull();
    expect(
      run(rule, ctx(series(range(100, 60, 1)), { funding: 0.001 })).entry,
    ).toBeNull();
  });
});
