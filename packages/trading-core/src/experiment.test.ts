import { describe, expect, it } from "vitest";
import { experimentConfigSchema, experimentSchema } from "./experiment.ts";

// Фиктивный эксперимент для тестов схемы (PS99): параметры ничего не значат.
const config = {
  timeframe: "1h",
  entry: { type: "emaCross", fast: 9, slow: 21 },
  exit: { stop: { type: "atr", mult: 2 }, takeProfit: { type: "rr", r: 2 } },
  universe: { type: "top", n: 10 },
  directions: ["long"],
  maxOpen: 3,
};

const experiment = {
  id: "PS99",
  market: "spot",
  name: "тест",
  hypothesis: "тест",
  config,
  initialBudget: 10_000,
  enabled: true,
  demoMirror: false,
};

/** Пути ошибок валидации: «config.marketFiltr» и т.п. */
const issuePaths = (value: unknown) => {
  const r = experimentSchema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("experimentConfigSchema: фильтры режима рынка и часов", () => {
  it("конфиг без новых полей разбирается как раньше", () => {
    expect(experimentConfigSchema.parse(config)).toEqual(config);
  });

  it("marketFilter: symbol по умолчанию BTCUSDT, minAdx необязателен", () => {
    const parsed = experimentConfigSchema.parse({
      ...config,
      marketFilter: { timeframe: "4h", ema: 50, long: "above", short: "any" },
    });
    expect(parsed.marketFilter).toEqual({
      symbol: "BTCUSDT",
      timeframe: "4h",
      ema: 50,
      long: "above",
      short: "any",
    });
  });

  it("sessionFilter: часы 0–24, дни 0–6; пустое окно и пустой фильтр — ошибка", () => {
    const ok = (sessionFilter: unknown) =>
      experimentConfigSchema.safeParse({ ...config, sessionFilter }).success;
    expect(ok({ hoursUtc: [22, 6] })).toBe(true);
    expect(ok({ days: [1, 2, 3] })).toBe(true);
    expect(ok({ hoursUtc: [0, 24], days: [0] })).toBe(true);
    expect(ok({ hoursUtc: [5, 5] })).toBe(false);
    expect(ok({ hoursUtc: [24, 2] })).toBe(false);
    expect(ok({ days: [7] })).toBe(false);
    expect(ok({})).toBe(false);
  });
});

describe("строгая схема конфига", () => {
  it("опечатка в поле конфига — ошибка с путём, а не молча отброшенное поле", () => {
    expect(
      issuePaths({
        ...experiment,
        config: {
          ...config,
          marketFiltr: { timeframe: "4h", ema: 50, long: "above" },
        },
      }),
    ).toEqual(["config"]);
    const r = experimentSchema.safeParse({
      ...experiment,
      config: { ...config, marketFiltr: {} },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      code: "unrecognized_keys",
      keys: ["marketFiltr"],
    });
  });

  it("лишние поля во входе, выходе, стопе, юниверсе и фильтрах — ошибки с путём", () => {
    const paths = issuePaths({
      ...experiment,
      config: {
        ...config,
        entry: { type: "emaCross", fast: 9, slow: 21, slowe: 50 },
        exit: {
          stop: { type: "atr", mult: 2, mul: 3 },
          takeProfit: { type: "rr", r: 2 },
          trailATR: 2,
        },
        universe: { type: "top", n: 10, blaclist: ["PEPE"] },
        trendFilter: { timeframe: "4h", period: 200, perod: 100 },
        marketFilter: {
          timeframe: "4h",
          ema: 50,
          long: "above",
          short: "below",
          minADX: 20,
        },
        sessionFilter: { hoursUtc: [8, 16], day: [1] },
      },
    });
    expect(paths.sort()).toEqual(
      [
        "config.entry",
        "config.exit",
        "config.exit.stop",
        "config.universe",
        "config.trendFilter",
        "config.marketFilter",
        "config.sessionFilter",
      ].sort(),
    );
  });

  it("лишние колонки строки БД на верхнем уровне эксперимента не мешают (резерв: resetAt и т.п.)", () => {
    expect(
      experimentSchema.safeParse({ ...experiment, resetAt: null }).success,
    ).toBe(true);
  });
});
