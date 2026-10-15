import { describe, expect, it } from "vitest";
import { mirrorLogEntry } from "./mirrorLog";

const c = {
  tradeId: "t1",
  experimentId: "F03",
  symbol: "BTCUSDT",
  market: "usdm" as const,
};

describe("mirrorLogEntry", () => {
  it("отказ — warn mirror.rejected с полями для фильтра журнала", () => {
    expect(mirrorLogEntry("rejected", c, "объём ниже минимума")).toEqual({
      level: "warn",
      event: "mirror.rejected",
      message: "F03 BTCUSDT: отказ — объём ниже минимума",
      data: {
        experimentId: "F03",
        tradeId: "t1",
        symbol: "BTCUSDT",
        market: "usdm",
        reason: "объём ниже минимума",
      },
    });
  });
  it("пропуск — info mirror.skipped", () => {
    expect(mirrorLogEntry("skipped", c, "вход старше 10 минут")).toMatchObject({
      level: "info",
      event: "mirror.skipped",
      message: "F03 BTCUSDT: пропуск — вход старше 10 минут",
    });
  });
});
