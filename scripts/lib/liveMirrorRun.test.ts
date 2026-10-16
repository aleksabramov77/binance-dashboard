import { describe, expect, it, vi } from "vitest";
import type { LiveMirrorState, LiveToClose } from "@/entities/experiment";
import type { TradeRequest, TradeResult } from "@/entities/trade";
import { sizeEntry } from "@/features/execute-trade";
import {
  closedByOf,
  type LiveExchange,
  type MirrorApi,
  runLiveMirror,
} from "./liveMirrorRun";

vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const NOW = Date.parse("2026-10-16T12:00:00Z");

const candidate = (
  tradeId: string,
  over: Partial<LiveMirrorState["candidates"][number]> = {},
) => ({
  tradeId,
  experimentId: "S98",
  market: "usdm" as const,
  symbol: "ETHUSDT",
  direction: "long" as const,
  openedAt: new Date(NOW - 60_000).toISOString(),
  entryPrice: 2000,
  quantity: 0.025,
  stop: 1900,
  takeProfit: 2200,
  ...over,
});

const state = (over: Partial<LiveMirrorState> = {}): LiveMirrorState => ({
  halt: { stopped: false, closeAllRequested: false },
  candidates: [candidate("t1")],
  active: [],
  dailyPnl: {},
  dayStart: "2026-10-16T00:00:00.000Z",
  toClose: [],
  openLegs: [],
  ...over,
});

function fakeApi(s: LiveMirrorState, closeItems: LiveToClose[] = []) {
  const api = {
    state: vi.fn(async () => s),
    claim: vi.fn(async () => ({ claimed: true, reason: null })),
    skip: vi.fn(async () => ({ ok: true as const })),
    open: vi.fn(async () => ({ ok: true as const })),
    claimClose: vi.fn(
      async (id: string) => closeItems.find((c) => c.tradeId === id) ?? null,
    ),
    close: vi.fn(async () => ({ ok: true as const })),
    legs: vi.fn(async () => ({ ok: true as const })),
    closeAllClaim: vi.fn(async () => closeItems),
    closeAllDone: vi.fn(async () => ({ ok: true as const })),
  } satisfies MirrorApi;
  return api;
}

const result = (req: TradeRequest): TradeResult => ({
  id: "r1",
  at: new Date(NOW).toISOString(),
  environment: "live",
  request: req,
  status: "protected",
  message: "ok",
  entryPrice: 2000,
  filledQuantity: req.quantity,
  steps: [],
  protectRefs: null,
});

function fakeExchange(over: Partial<LiveExchange> = {}): LiveExchange {
  return {
    placeTrade: vi.fn(async (req) => result(req)),
    closePosition: vi.fn(async () => ({
      status: "closed" as const,
      message: "Позиция закрыта по рынку.",
      steps: [],
      exitPrice: 2100,
    })),
    sweepLegs: vi.fn(async () => []),
    symbolRules: vi.fn(async () => ({
      minQty: 0.001,
      minNotional: 5,
      stepSize: "0.001",
    })),
    price: vi.fn(async () => 2000),
    balances: vi.fn(async () => ({ spot: 100, usdm: 100 })),
    positionMode: vi.fn(async () => "oneway" as const),
    futuresBusy: vi.fn(async () => false),
    enableOneway: vi.fn(async () => "switched"),
    fills: vi.fn(async () => [
      {
        time: NOW - 30_000,
        side: "BUY" as const,
        qty: 0.005,
        quoteQty: 10,
        commission: 0.004,
        commissionAsset: "USDT",
      },
      {
        time: NOW,
        side: "SELL" as const,
        qty: 0.005,
        quoteQty: 10.5,
        commission: 0.0042,
        commissionAsset: "USDT",
      },
    ]),
    sizeEntry,
    spotSlippage: 0.005,
    ...over,
  };
}

const run = (
  api: MirrorApi,
  ex: LiveExchange,
  over: { verdictOk?: boolean; keyAccepted?: boolean } = {},
) =>
  runLiveMirror({
    api,
    ex,
    now: () => NOW,
    verdictOk: over.verdictOk ?? true,
    keyAccepted: over.keyAccepted ?? true,
  });

describe("runLiveMirror: вход", () => {
  it("вход на $10 по шагу символа, без повторного подъёма; итог — в API с уровнями и объёмом", async () => {
    const api = fakeApi(state());
    const ex = fakeExchange();
    const r = await run(api, ex);
    expect(r.run?.opened).toEqual([
      { tradeId: "t1", symbol: "ETHUSDT", status: "protected" },
    ]);
    expect(ex.placeTrade).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETHUSDT",
        quantity: 0.005,
        fitMinNotional: false,
        leverage: 1,
        stopLoss: 1900,
        takeProfit: 2200,
      }),
    );
    expect(api.claim).toHaveBeenCalledWith("t1");
    expect(api.open).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: "t1",
        order: {
          stopLoss: 1900,
          takeProfit: 2200,
          notionalUsd: 10,
          raised: null,
        },
      }),
    );
  });

  it("стоп входов — пропуск без захвата и без биржи", async () => {
    const api = fakeApi(
      state({ halt: { stopped: true, closeAllRequested: false } }),
    );
    const ex = fakeExchange();
    await run(api, ex);
    expect(api.skip).toHaveBeenCalledWith("t1", "входы остановлены");
    expect(api.claim).not.toHaveBeenCalled();
    expect(ex.placeTrade).not.toHaveBeenCalled();
  });

  it("дневной лимит — только этого эксперимента: S98 пропущен, PS99 входит", async () => {
    const api = fakeApi(
      state({
        candidates: [
          candidate("a"),
          candidate("b", { experimentId: "PS99", symbol: "SOLUSDT" }),
        ],
        dailyPnl: { S98: -15.5 },
      }),
    );
    const ex = fakeExchange();
    await run(api, ex);
    expect(api.skip).toHaveBeenCalledWith(
      "a",
      expect.stringMatching(/^дневной лимит убытка эксперимента: −\$15,50/),
    );
    expect(ex.placeTrade).toHaveBeenCalledTimes(1);
    expect(ex.placeTrade).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "SOLUSDT" }),
    );
  });

  it("по монете уже есть реальная позиция — пропуск", async () => {
    const api = fakeApi(
      state({
        active: [
          {
            tradeId: "old",
            experimentId: "PS99",
            market: "usdm",
            symbol: "ETHUSDT",
            direction: "long",
            status: "protected",
            openedAt: new Date(NOW - 3_600_000).toISOString(),
          },
        ],
      }),
    );
    await run(api, fakeExchange());
    expect(api.skip).toHaveBeenCalledWith(
      "t1",
      "по монете уже есть реальная позиция",
    );
  });

  it("фьючерсы в Hedge и счёт не пуст — пропуск; пуст — переключение в One-way и вход", async () => {
    const busy = fakeExchange({
      positionMode: vi.fn(async () => "hedge" as const),
      futuresBusy: vi.fn(async () => true),
    });
    const api = fakeApi(state());
    await run(api, busy);
    expect(api.skip).toHaveBeenCalledWith(
      "t1",
      "реальные фьючерсы не в One-way (Hedge mode)",
    );
    const empty = fakeExchange({
      positionMode: vi.fn(async () => "hedge" as const),
    });
    await run(fakeApi(state()), empty);
    expect(empty.enableOneway).toHaveBeenCalled();
    expect(empty.placeTrade).toHaveBeenCalled();
  });

  it("приложение не ответило — исключение, на бирже ничего", async () => {
    const api = fakeApi(state());
    api.state.mockRejectedValue(new Error("приложение не ответило"));
    const ex = fakeExchange();
    await expect(run(api, ex)).rejects.toThrow(/не ответило/);
    expect(ex.placeTrade).not.toHaveBeenCalled();
    expect(ex.closePosition).not.toHaveBeenCalled();
  });
});

const item: LiveToClose = {
  tradeId: "c1",
  experimentId: "S98",
  market: "usdm",
  symbol: "ETHUSDT",
  direction: "long",
  quantity: 0.005,
  exitReason: "takeProfit",
  protectRefs: null,
  entryPrice: 2000,
  openedAt: new Date(NOW - 60_000).toISOString(),
};

describe("runLiveMirror: закрытия и «Закрыть всё»", () => {
  it("paper-сделка закрылась — закрытие по рынку, PnL и комиссии по исполнениям", async () => {
    const api = fakeApi(state({ candidates: [], toClose: ["c1"] }), [item]);
    await run(api, fakeExchange());
    expect(api.close).toHaveBeenCalledWith({
      tradeId: "c1",
      status: "closed",
      exit: expect.objectContaining({
        exitPrice: 2100,
        closedBy: "mirror",
      }),
    });
    const [body] = api.close.mock.calls[0] as unknown as [
      { exit: { realizedPnl: number; feesUsd: number } },
    ];
    expect(body.exit.realizedPnl).toBeCloseTo(0.5 - 0.0082);
    expect(body.exit.feesUsd).toBeCloseTo(0.0082);
  });

  it("ключ не годится — ни входов, ни закрытий; «Закрыть всё» — да, если Binance принимает ключ", async () => {
    const s = state({
      halt: { stopped: true, closeAllRequested: true },
      toClose: ["c1"],
    });
    const api = fakeApi(s, [item]);
    const ex = fakeExchange();
    const r = await run(api, ex, { verdictOk: false, keyAccepted: true });
    expect(r.closeAll).toEqual({ closed: 1, failed: 0, errors: [] });
    expect(api.closeAllDone).toHaveBeenCalledWith({
      closed: 1,
      failed: 0,
      errors: [],
    });
    expect(api.close).toHaveBeenCalledWith(
      expect.objectContaining({
        exit: expect.objectContaining({ closedBy: "close_all" }),
      }),
    );
    expect(ex.placeTrade).not.toHaveBeenCalled();
    expect(api.claimClose).not.toHaveBeenCalled();

    const rejected = fakeApi(s, [item]);
    await run(rejected, fakeExchange(), {
      verdictOk: false,
      keyAccepted: false,
    });
    expect(rejected.closeAllClaim).not.toHaveBeenCalled();
  });

  it("закрытие не удалось — failed в итоге «Закрыть всё» с ошибкой", async () => {
    const api = fakeApi(
      state({
        candidates: [],
        halt: { stopped: true, closeAllRequested: true },
      }),
      [item],
    );
    const ex = fakeExchange({
      closePosition: vi.fn(async () => ({
        status: "failed" as const,
        message: "сеть",
        steps: [],
        exitPrice: null,
      })),
    });
    const r = await run(api, ex);
    expect(r.closeAll).toEqual({
      closed: 0,
      failed: 1,
      errors: ["ETHUSDT: сеть"],
    });
  });
});

describe("closedByOf", () => {
  it("биржа закрыла (TP/SL) — по знаку PnL; иначе — зеркало или «Закрыть всё»", () => {
    expect(
      closedByOf(
        "Позиция уже закрыта биржей (сработал стоп/тейк).",
        1,
        "mirror",
      ),
    ).toBe("tp");
    expect(
      closedByOf("Монеты уже проданы (сработал TP/SL на бирже).", -1, "mirror"),
    ).toBe("sl");
    expect(closedByOf("Позиция закрыта по рынку.", 1, "close_all")).toBe(
      "close_all",
    );
  });
});
