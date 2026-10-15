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
    activeMirrors: async () => [],
    positionMode: async () => "oneway",
    hasSymbol: async () => true,
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
    sweepLegs: async () => [],
    listToClose: async () => [],
    claimToClose: async () => null,
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
      listToClose: async () => ["c1", "taken"],
      // "taken" уже захватил другой прогон.
      claimToClose: async (tradeId) =>
        tradeId === "c1"
          ? {
              tradeId: "c1",
              market: "spot",
              symbol: "BTCUSDT",
              direction: "long",
              quantity: 0.001,
            }
          : null,
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

  it("монеты нет на демо — пропуск без запроса на вход; сбой проверки — сделку не захватываем", async () => {
    const open = vi.fn();
    const claim = vi.fn(async () => true);
    const d = deps({
      listCandidates: async () => [
        trade({ tradeId: "chip", symbol: "CHIPUSDT" }),
        trade({ tradeId: "net", symbol: "PUMPUSDT" }),
      ],
      hasSymbol: async (_market, symbol) => {
        if (symbol === "PUMPUSDT") throw new Error("сеть");
        return false;
      },
      claim,
      open,
    });
    const r = await runMirror(d);
    expect(open).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(r.skipped).toBe(1);
    expect(d.markSkipped).toHaveBeenCalledWith(
      "chip",
      "CHIPUSDT: нет на демо-фьючерсах.",
    );
  });

  it("бюджет времени: после 200 с новые входы не начинаются, остаток — следующему прогону", async () => {
    let clock = NOW;
    const open = vi.fn(async () => {
      clock += 120_000; // вход при сбое биржи шёл долго
      return {
        id: "r",
        status: "protected" as const,
        message: "ok",
        entryPrice: 100,
        filledQuantity: 0.5,
        steps: [],
      };
    });
    const claim = vi.fn(async () => true);
    const r = await runMirror(
      deps({
        now: () => clock,
        open,
        claim,
        listCandidates: async () => [
          trade({ tradeId: "t1", symbol: "AUSDT" }),
          trade({ tradeId: "t2", symbol: "BUSDT" }),
          trade({ tradeId: "t3", symbol: "CUSDT" }),
        ],
      }),
    );
    // t1 — 120 с, t2 начат (120 ≤ 200) и закончился на 240 с, t3 не начат и не захвачен.
    expect(r.opened.map((o) => o.tradeId)).toEqual(["t1", "t2"]);
    expect(r.deferred).toBe(1);
    expect(r.skipped).toBe(0);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).not.toHaveBeenCalledWith("t3");
  });

  it("бюджет времени на закрытия: после 200 с позиции не захватываются, входы не начинаются", async () => {
    let clock = NOW;
    const claimToClose = vi.fn(async (tradeId: string) => ({
      tradeId,
      market: "futures" as const,
      symbol: "ETHUSDT",
      direction: "long" as const,
      quantity: 1,
    }));
    const open = vi.fn();
    const r = await runMirror(
      deps({
        now: () => clock,
        listToClose: async () => ["c1", "c2", "c3"],
        claimToClose,
        close: async () => {
          clock += 150_000; // закрытие при сбое биржи шло долго
          return {
            status: "closed",
            message: "ok",
            steps: [],
            exitPrice: null,
          };
        },
        open,
        listCandidates: async () => [trade({ tradeId: "a" })],
      }),
    );
    // c1 — до 150 с, c2 начат (150 ≤ 200) и закончился на 300 с, c3 не захвачен.
    expect(r.closed.map((c) => c.tradeId)).toEqual(["c1", "c2"]);
    expect(r.deferredCloses).toBe(1);
    expect(claimToClose).not.toHaveBeenCalledWith("c3");
    expect(open).not.toHaveBeenCalled();
    expect(r.deferred).toBe(1);
  });

  it("сначала сверка своих ног: закрытые биржей зеркала — в результате, до закрытий и входов", async () => {
    const order: string[] = [];
    const r = await runMirror(
      deps({
        sweepLegs: async () => {
          order.push("sweep");
          return [{ tradeId: "m1", symbol: "ADAUSDT" }];
        },
        listToClose: async () => {
          order.push("list");
          return [];
        },
      }),
    );
    expect(order).toEqual(["sweep", "list"]);
    expect(r.swept).toEqual([{ tradeId: "m1", symbol: "ADAUSDT" }]);
  });
});
