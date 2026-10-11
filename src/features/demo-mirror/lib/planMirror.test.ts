import { describe, expect, it } from "vitest";
import { type MirrorTradeInput, mirrorLevels, planMirror } from "./planMirror";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const trade = (over: Partial<MirrorTradeInput> = {}): MirrorTradeInput => ({
  tradeId: "t1",
  market: "futures",
  symbol: "ETHUSDT",
  direction: "long",
  openedAt: "2026-10-11T11:59:00Z",
  entryPrice: 100,
  quantity: 0.5,
  stop: 95,
  takeProfit: 110,
  ...over,
});

describe("mirrorLevels", () => {
  it("берёт paper-уровни как есть", () => {
    expect(mirrorLevels(trade())).toEqual({ stopLoss: 95, takeProfit: 110 });
  });

  it("без TP — дальний TP в 10R", () => {
    expect(mirrorLevels(trade({ takeProfit: null }))).toEqual({
      stopLoss: 95,
      takeProfit: 150,
    });
    expect(
      mirrorLevels(trade({ direction: "short", stop: 105, takeProfit: null })),
    ).toEqual({ stopLoss: 105, takeProfit: 50 });
  });

  it("без стопа — страховочный стоп в 50%, TP шорта не уходит в ноль", () => {
    const short = mirrorLevels(
      trade({ direction: "short", stop: null, takeProfit: null }),
    );
    expect(short.stopLoss).toBe(150);
    expect(short.takeProfit).toBe(10);
  });
});

describe("planMirror", () => {
  it("открывает свежую сделку с плечом 1", () => {
    const [d] = planMirror([trade()], new Set(), NOW);
    expect(d).toEqual({
      tradeId: "t1",
      kind: "open",
      request: {
        symbol: "ETHUSDT",
        market: "futures",
        direction: "long",
        quantity: 0.5,
        leverage: 1,
        fitMinNotional: true,
        stopOnly: false,
        stopLoss: 95,
        takeProfit: 110,
      },
    });
  });

  it("пропускает старые входы, не-USDT пары и занятые символы", () => {
    const decisions = planMirror(
      [
        trade({ tradeId: "old", openedAt: "2026-10-11T11:40:00Z" }),
        trade({ tradeId: "usdc", symbol: "ETHUSDC" }),
        trade({ tradeId: "busy", symbol: "BTCUSDT" }),
        trade({ tradeId: "a" }),
        trade({ tradeId: "b" }),
        trade({ tradeId: "spot", market: "spot" }),
      ],
      new Set(["futures:BTCUSDT"]),
      NOW,
    );
    expect(decisions.map((d) => [d.tradeId, d.kind])).toEqual([
      ["old", "skip"],
      ["usdc", "skip"],
      ["busy", "skip"],
      ["a", "open"],
      ["b", "skip"],
      ["spot", "open"],
    ]);
  });

  it("без TP у paper-сделки — на бирже только стоп", () => {
    const [d] = planMirror([trade({ takeProfit: null })], new Set(), NOW);
    expect(d.kind === "open" && d.request.stopOnly).toBe(true);
  });
});
