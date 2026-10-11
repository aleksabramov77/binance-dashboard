import { describe, expect, it, vi } from "vitest";
import type { MirrorTradeInput } from "../lib/planMirror";
import { type MirrorDeps, runMirror } from "./runMirror";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const trade = (over: Partial<MirrorTradeInput>): MirrorTradeInput => ({
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

function deps(over: Partial<MirrorDeps> = {}): MirrorDeps {
  return {
    now: () => NOW,
    configured: true,
    listCandidates: async () => [],
    busySymbols: async () => new Set(),
    claim: async () => true,
    open: async () => ({
      id: "r1",
      status: "protected",
      message: "ok",
      entryPrice: 100,
      filledQuantity: 0.5,
      steps: [],
    }),
    markSkipped: vi.fn(async () => {}),
    saveOpen: vi.fn(async () => {}),
    claimToClose: async () => [],
    close: async () => ({
      status: "closed",
      message: "ok",
      steps: [],
      exitPrice: null,
    }),
    saveClose: vi.fn(async () => {}),
    ...over,
  };
}

describe("runMirror", () => {
  it("без ключа демо ничего не делает", async () => {
    const open = vi.fn();
    const r = await runMirror(
      deps({
        configured: false,
        open,
        listCandidates: async () => [trade({})],
      }),
    );
    expect(r.opened).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("закрывает, затем открывает; захваченную другим прогоном сделку не трогает", async () => {
    const order: string[] = [];
    const d = deps({
      claimToClose: async () => [
        {
          tradeId: "c1",
          market: "spot",
          symbol: "BTCUSDT",
          direction: "long",
          quantity: 0.001,
        },
      ],
      close: async () => {
        order.push("close");
        return { status: "closed", message: "ok", steps: [], exitPrice: null };
      },
      listCandidates: async () => [
        trade({ tradeId: "a" }),
        trade({ tradeId: "b", symbol: "SOLUSDT" }),
        trade({
          tradeId: "old",
          symbol: "XRPUSDT",
          openedAt: "2026-10-11T11:00:00Z",
        }),
      ],
      claim: async (id) => id !== "b",
      open: async (req) => {
        order.push(`open ${req.symbol}`);
        return {
          id: "r",
          status: "protected",
          message: "ok",
          entryPrice: 100,
          filledQuantity: req.quantity,
          steps: [],
        };
      },
    });
    const r = await runMirror(d);
    expect(order).toEqual(["close", "open ETHUSDT"]);
    expect(r.closed).toEqual([
      { tradeId: "c1", symbol: "BTCUSDT", status: "closed" },
    ]);
    expect(r.opened).toEqual([
      { tradeId: "a", symbol: "ETHUSDT", status: "protected" },
    ]);
    expect(r.skipped).toBe(1);
    expect(d.markSkipped).toHaveBeenCalledWith("old", expect.any(String));
  });
});
