import type { ExperimentConfig } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import {
  describeConfig,
  describeEntry,
  describeUniverse,
} from "./describeConfig";

const config: ExperimentConfig = {
  timeframe: "15m",
  entry: { type: "emaCross", fast: 9, slow: 21 },
  exit: {
    stop: { type: "atr", mult: 1.5 },
    takeProfit: { type: "rr", r: 2 },
    trailAtr: 3,
    breakevenAtR: 1,
  },
  universe: { type: "top", n: 30 },
  directions: ["long", "short"],
  trendFilter: { timeframe: "1h", period: 200 },
  maxOpen: 5,
};

describe("describeConfig", () => {
  it("описывает вход, стоп, тейк, трейлинг, юниверс и ТФ по-русски", () => {
    const lines = Object.fromEntries(
      describeConfig(config).map((l) => [l.label, l.value]),
    );
    expect(lines).toMatchObject({
      Таймфрейм: "15m",
      Вход: "пересечение EMA 9 и EMA 21",
      Направление: "лонг и шорт",
      Стоп: "1,5 × ATR от входа",
      Тейк: "2 R",
      Трейлинг: "3 × ATR от экстремума",
      Юниверс: "топ-30 по обороту за 24 ч",
      "Фильтр тренда": "по EMA 200 на 1h",
      Безубыток: "при +1 R",
    });
  });

  it("без тейка и трейлинга пишет об этом явно", () => {
    const lines = describeConfig({
      ...config,
      exit: { stop: { type: "none" }, takeProfit: null },
    });
    expect(lines.find((l) => l.label === "Тейк")?.value).toBe("без тейка");
    expect(lines.find((l) => l.label === "Трейлинг")?.value).toBe("нет");
  });
});

describe("describeEntry", () => {
  it("доли переводит в проценты без хвостов плавающей точки", () => {
    expect(describeEntry({ type: "funding", threshold: 0.0005 })).toContain(
      "0,05 %",
    );
  });
});

describe("describeUniverse", () => {
  it("добавляет чёрный список", () => {
    expect(
      describeUniverse({ type: "movers", n: 15, blacklist: ["PIXEL", "OP"] }),
    ).toBe("15 лидеров роста и 15 падения за 24 ч; без PIXEL, OP");
  });
});
