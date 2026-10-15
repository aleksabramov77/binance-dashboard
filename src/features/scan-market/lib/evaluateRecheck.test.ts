import { describe, expect, it } from "vitest";
import type { Setup } from "@/entities/market-signal";
import { evaluateRecheck } from "./evaluateRecheck";

const setup: Setup = {
  id: "XUSDT:long",
  symbol: "XUSDT",
  base: "X",
  kind: "rebound-long",
  direction: "long",
  market: "usdm",
  status: "ready",
  entry: 100,
  stopLoss: 95,
  takeProfit1: 106,
  takeProfit2: 110,
  rr: 1.2,
  strength: 0.5,
  reasons: [],
  change24h: -0.1,
  quoteVolumeUsd: 1e8,
  indicators: {
    rsi1h: 25,
    rsi4h: 30,
    atr1h: 2,
    ema20: 106,
    ema50: 110,
    volumeRatio: 1,
    distanceAtr: -5,
  },
};
const at = "2026-10-09T12:00:00.000Z";

describe("evaluateRecheck", () => {
  it("актуален, если правила выполняются и уровни почти не сдвинулись", () => {
    const fresh = { ...setup, entry: 100.2 };
    const r = evaluateRecheck(setup, 100.2, fresh, [], at);
    expect(r).toMatchObject({ status: "actual", notes: [] });
  });

  it("показывает новые уровни, если они заметно сдвинулись", () => {
    const fresh = { ...setup, entry: 98, stopLoss: 93, takeProfit1: 105 };
    const r = evaluateRecheck(setup, 98, fresh, [], at);
    expect(r.status).toBe("changed");
    expect(r.fresh?.stopLoss).toBe(93);
    expect(r.notes).toEqual([
      "Вход: 100 → 98",
      "Stop Loss: 95 → 93",
      "Take Profit 1: 106 → 105",
    ]);
  });

  it("устарел, если цена уже за стопом или у цели", () => {
    expect(evaluateRecheck(setup, 94, setup, [], at).status).toBe("stale");
    const late = evaluateRecheck(setup, 107, setup, [], at);
    expect(late.status).toBe("stale");
    expect(late.notes[0]).toContain("вход поздний");
  });

  it("устарел и объясняет, какие условия больше не выполняются", () => {
    const checks = [
      { ok: true, label: "Изменение за 24 ч −9%" },
      { ok: false, label: "RSI 1h 48 (нужно ≤ 35)" },
    ];
    const r = evaluateRecheck(setup, 101, null, checks, at);
    expect(r.status).toBe("stale");
    expect(r.notes).toEqual([
      "Условия сетапа больше не выполняются:",
      "✗ RSI 1h 48 (нужно ≤ 35)",
    ]);
  });

  it("предупреждает, если разворотная свеча пропала", () => {
    const r = evaluateRecheck(
      setup,
      100,
      { ...setup, status: "watch" },
      [],
      at,
    );
    expect(r.status).toBe("changed");
    expect(r.notes).toEqual([
      "Разворотная свеча пропала — надёжнее дождаться новой.",
    ]);
  });
});
