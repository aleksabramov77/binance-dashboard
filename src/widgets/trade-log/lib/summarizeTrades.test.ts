import { describe, expect, it } from "vitest";
import type { ExecutedOrder } from "@/entities/trade";
import { summarizeTrades } from "./summarizeTrades";

const order = ({
  trade,
  ...patch
}: Partial<Omit<ExecutedOrder, "trade">> & {
  trade: Partial<ExecutedOrder["trade"]>;
}): ExecutedOrder => ({
  id: Math.random().toString(),
  market: "usdm",
  symbol: "BATUSDT",
  side: "SELL",
  at: "2026-10-10T00:00:00Z",
  quantity: 1,
  avgPrice: 1,
  quoteQty: 1,
  commissions: [],
  realizedPnl: null,
  ...patch,
  trade: {
    status: "open",
    role: "entry",
    stopPrice: null,
    unrealizedPnl: null,
    ...trade,
  },
});

describe("summarizeTrades", () => {
  it("считает выходы, плюс/минус и uPnL открытых один раз на позицию", () => {
    const s = summarizeTrades([
      order({ realizedPnl: 2, trade: { status: "tp", role: "exit" } }),
      order({ realizedPnl: -1.5, trade: { status: "sl", role: "exit" } }),
      order({ realizedPnl: 0, trade: { status: "tp", role: "entry" } }),
      order({ symbol: "ZKUSDT", trade: { status: "open", unrealizedPnl: 3 } }),
      order({ symbol: "ZKUSDT", trade: { status: "open", unrealizedPnl: 3 } }),
      order({
        symbol: "US",
        trade: { status: "open-unprotected", unrealizedPnl: -1 },
      }),
    ]);
    expect(s).toEqual({
      closed: 2,
      wins: 1,
      losses: 1,
      realizedPnl: 0.5,
      open: 2,
      unrealizedPnl: 2,
    });
  });

  it("пустая история — нули", () => {
    expect(summarizeTrades([]).closed).toBe(0);
  });
});
