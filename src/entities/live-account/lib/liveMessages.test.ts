import { describe, expect, it } from "vitest";
import { nextUtcMidnight, utcDayStart } from "./liveDay";
import {
  liveDailyLimitText,
  liveEntryText,
  liveExitText,
} from "./liveMessages";

const s = {
  experimentId: "S98",
  symbol: "BTCUSDT",
  market: "usdm" as const,
  direction: "long" as const,
};

describe("тексты реального зеркала", () => {
  it("вход: объём, пометка минимума биржи, SL и TP", () => {
    expect(
      liveEntryText(s, {
        notionalUsd: 50,
        raised: "minNotional",
        stopLoss: 95000,
        takeProfit: 110000,
      }),
    ).toBe(
      "🟢 Реальная сделка: S98 BTCUSDT (USDⓈ-M) long $50,00 (минимум биржи), SL 95000, TP 110000",
    );
  });
  it("причина объёма: «минимум биржи» — только для minNotional", () => {
    const o = { notionalUsd: 11.47, stopLoss: 40966, takeProfit: null };
    expect(liveEntryText(s, { ...o, raised: "spotStop" })).toMatch(
      /\$11,47 \(стоп после комиссии должен пройти минимум ордера\)/,
    );
    expect(liveEntryText(s, { ...o, raised: null })).not.toMatch(/минимум/);
  });

  it("выход с PnL и причиной", () => {
    expect(liveExitText(s, { realizedPnl: 0.84, closedBy: "tp" })).toBe(
      "🔴 Закрыта: S98 BTCUSDT (USDⓈ-M) long +$0,84 (TP)",
    );
    expect(
      liveExitText(s, { realizedPnl: -1.5, closedBy: "close_all" }),
    ).toMatch(/−\$1,50 \(«Закрыть всё»\)$/);
  });
  it("дневной лимит — эксперимент и сумма", () => {
    expect(liveDailyLimitText("S98", -15.2)).toMatch(
      /S98 −\$15,20 за сутки \(лимит −\$15\)/,
    );
  });
});

describe("сутки UTC", () => {
  it("начало суток и следующая полночь", () => {
    const now = Date.parse("2026-10-16T21:30:00+03:00");
    expect(utcDayStart(now).toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });
});
