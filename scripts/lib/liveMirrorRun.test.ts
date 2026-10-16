import { describe, expect, it, vi } from "vitest";
import type { LiveMirrorState, LiveToClose } from "@/entities/experiment";
import type { TradeRequest, TradeResult } from "@/entities/trade";
import { sizeEntry } from "@/features/execute-trade";
import {
  closedByOf,
  closeOne,
  createDeliver,
  DELIVER_RETRY_MS,
  type LiveExchange,
  liveOrderSeed,
  type MirrorApi,
  type OutboxItem,
  reconcileEntry,
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
  stalePending: [],
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
    reconcile: vi.fn(async () => ({ ok: true as const })),
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
    placeTrade: vi.fn(async (req: TradeRequest, _seed: string) => result(req)),
    spotOrder: vi.fn(async () => null),
    // Свои ордера сделки: вход -M — #101, закрытие -C — #102 (исполнения ниже — с этими orderId).
    futuresOrder: vi.fn(async (_symbol: string, cid: string) =>
      cid.endsWith("-M")
        ? { orderId: 101, status: "FILLED", executedQty: 0.005, avgPrice: 2000 }
        : cid.endsWith("-C")
          ? {
              orderId: 102,
              status: "FILLED",
              executedQty: 0.005,
              avgPrice: 2100,
            }
          : null,
    ),
    algoOrder: vi.fn(async () => null),
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
        orderId: 101,
        time: NOW - 30_000,
        side: "BUY" as const,
        qty: 0.005,
        quoteQty: 10,
        commission: 0.004,
        commissionAsset: "USDT",
      },
      {
        orderId: 102,
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

const spotOrd = (
  orderId: number,
  status: string,
  executedQty: number,
  cummulativeQuoteQty: number,
  orderListId = -1,
) => ({ orderId, orderListId, status, executedQty, cummulativeQuoteQty });

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
      liveOrderSeed("t1"),
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
      liveOrderSeed("b"),
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
            entryPrice: 2000,
            quantity: 0.005,
            stopLoss: 1900,
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
  stopLoss: null,
  openedAt: new Date(NOW - 60_000).toISOString(),
};

describe("runLiveMirror: закрытия и «Закрыть всё»", () => {
  it("paper-сделка закрылась — закрытие по рынку, PnL и комиссии по исполнениям", async () => {
    const api = fakeApi(state({ candidates: [], toClose: ["c1"] }), [item]);
    await run(api, fakeExchange());
    expect(api.close).toHaveBeenCalledWith({
      tradeId: "c1",
      status: "closed",
      protectionRemoved: false,
      exit: expect.objectContaining({
        exitPrice: 2100,
        closedBy: "mirror",
        leftover: null,
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

describe("closeOne: попытка закрытия (приёмка 0049)", () => {
  it("выход не прошёл после снятия своих TP/SL — protectionRemoved, failed (строка вернётся в очередь)", async () => {
    const ex = fakeExchange({
      closePosition: vi.fn(async () => ({
        status: "failed" as const,
        message: "timeout",
        steps: [],
        exitPrice: null,
        protectionRemoved: true,
      })),
    });
    const body = await closeOne(ex, item, "mirror");
    expect(body).toMatchObject({ status: "failed", protectionRemoved: true });
    expect(ex.fills).not.toHaveBeenCalled();
  });

  it("исключение биржи — failed, а не обрыв прогона", async () => {
    const ex = fakeExchange({
      closePosition: vi.fn(async () => {
        throw new Error("-1021 Timestamp outside of recvWindow");
      }),
    });
    const body = await closeOne(ex, item, "close_all");
    expect(body).toMatchObject({
      status: "failed",
      protectionRemoved: false,
      exit: { message: expect.stringMatching(/-1021/) },
    });
  });

  it("спот с пылью: остаток — отдельно, в PnL не входит", async () => {
    const ex = fakeExchange({
      spotOrder: vi.fn(async (_symbol: string, cid: string) =>
        cid.endsWith("-W")
          ? spotOrd(201, "FILLED", 0.00014, 0.00014 * 81_932.01)
          : cid.endsWith("-C")
            ? spotOrd(202, "FILLED", 0.00013, 0.00013 * 82_060)
            : null,
      ),
      fills: vi.fn(async () => [
        {
          orderId: 201,
          time: NOW - 30_000,
          side: "BUY" as const,
          qty: 0.00014,
          quoteQty: 0.00014 * 81_932.01,
          commission: 0.00000014,
          commissionAsset: "BTC",
        },
        {
          orderId: 202,
          time: NOW,
          side: "SELL" as const,
          qty: 0.00013,
          quoteQty: 0.00013 * 82_060,
          commission: 0.0107,
          commissionAsset: "USDT",
        },
      ]),
    });
    const body = await closeOne(
      ex,
      { ...item, market: "spot", symbol: "BTCUSDT" },
      "mirror",
    );
    expect(body.exit.leftover).toMatchObject({ asset: "BTC" });
    expect(body.exit.leftover?.qty).toBeCloseTo(0.00000986, 10);
    expect(body.exit.realizedPnl ?? 0).toBeGreaterThan(-0.01);
    expect(body.exit.message).toMatch(
      /Остаток 0\.00000986 BTC ≈ \$0,81 остался на субсчёте — в PnL не входит/,
    );
  });
});

describe("PnL закрытия: только свои ордера, иначе — оценка", () => {
  it("исполнения не прочитаны — оценка по ценам входа и выхода, pnlEstimated", async () => {
    const ex = fakeExchange({
      fills: vi.fn(async () => {
        throw new Error("-1003 Too many requests");
      }),
    });
    const body = await closeOne(ex, item, "mirror");
    expect(body.status).toBe("closed");
    expect(body.exit.pnlEstimated).toBe(true);
    // long 0.005: (2100 − 2000) × 0.005 = 0,5 минус taker 0,05% с обеих сторон.
    expect(body.exit.realizedPnl).toBeCloseTo(0.5 - 0.005 * 4100 * 0.0005);
    expect(body.exit.message).toMatch(/оценка/);
  });

  it("своих ордеров на бирже нет — оценка; чужие исполнения той же монеты в PnL не входят", async () => {
    const ex = fakeExchange({
      futuresOrder: vi.fn(async () => null),
      fills: vi.fn(async () => [
        {
          orderId: 999,
          time: NOW,
          side: "SELL" as const,
          qty: 1,
          quoteQty: 5000,
          commission: 1,
          commissionAsset: "USDT",
        },
      ]),
    });
    const body = await closeOne(ex, item, "mirror");
    expect(body.exit.pnlEstimated).toBe(true);
    expect(body.exit.realizedPnl).toBeCloseTo(0.5 - 0.005 * 4100 * 0.0005);
    expect(ex.fills).not.toHaveBeenCalled();
  });

  it("исполнения соседней сделки той же монеты отброшены по orderId", async () => {
    const ex = fakeExchange();
    const own = await ex.fills("usdm", "ETHUSDT");
    vi.mocked(ex.fills).mockResolvedValue([
      ...own,
      { ...own[1], orderId: 555, quoteQty: 50, qty: 0.025 },
    ]);
    const body = await closeOne(ex, item, "mirror");
    expect(body.exit.pnlEstimated).toBe(false);
    expect(body.exit.realizedPnl).toBeCloseTo(0.5 - 0.0082);
  });
});

describe("итог не дошёл до приложения — повторы и outbox (ревью PR #89)", () => {
  it("open упал трижды — итог в outbox, следующий прогон досылает его до новых решений", async () => {
    const api = fakeApi(state());
    api.open.mockRejectedValue(new Error("502"));
    const outbox: OutboxItem[] = [];
    const sleep = vi.fn(async (_ms: number) => {});
    const onLost = vi.fn();
    await runLiveMirror({
      api,
      ex: fakeExchange(),
      now: () => NOW,
      verdictOk: true,
      keyAccepted: true,
      outbox,
      sleep,
      onLost,
    });
    expect(api.open).toHaveBeenCalledTimes(1 + DELIVER_RETRY_MS.length);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([...DELIVER_RETRY_MS]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: "open", body: { tradeId: "t1" } });
    expect(onLost).toHaveBeenCalledTimes(1);

    const next = fakeApi(state({ candidates: [] }));
    const r = await runLiveMirror({
      api: next,
      ex: fakeExchange(),
      now: () => NOW,
      verdictOk: true,
      keyAccepted: true,
      outbox,
      sleep,
    });
    expect(r.flushed).toBe(1);
    expect(next.open).toHaveBeenCalledWith(
      expect.objectContaining({ tradeId: "t1" }),
    );
    expect(outbox).toHaveLength(0);
    // Досылка — раньше чтения состояния: pending-строка получает свои ордера до новых решений.
    expect(next.open.mock.invocationCallOrder[0]).toBeLessThan(
      next.state.mock.invocationCallOrder[0],
    );
  });

  it("досылка снова не прошла — итог остаётся в outbox", async () => {
    const api = fakeApi(state({ candidates: [] }));
    api.close.mockRejectedValue(new Error("сеть"));
    const outbox: OutboxItem[] = [
      {
        kind: "close",
        body: {
          tradeId: "c1",
          status: "closed",
          protectionRemoved: false,
          exit: {
            message: "ok",
            steps: [],
            exitPrice: 2100,
            feesUsd: 0,
            realizedPnl: 0.5,
            pnlEstimated: false,
            leftover: null,
            closedBy: "mirror",
          },
        },
      },
    ];
    const r = await runLiveMirror({
      api,
      ex: fakeExchange(),
      now: () => NOW,
      verdictOk: true,
      keyAccepted: true,
      outbox,
      sleep: async () => {},
    });
    expect(r.flushed).toBe(0);
    expect(outbox).toHaveLength(1);
  });

  it("вторая попытка прошла — outbox пуст", async () => {
    const outbox: OutboxItem[] = [];
    const deliver = createDeliver(outbox, async () => {});
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValue({ ok: true });
    await deliver({ kind: "legs", body: { items: [] } }, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(outbox).toHaveLength(0);
  });
});

describe("остановка воркера (SIGTERM)", () => {
  it("stopRequested — новых входов нет, кандидаты ждут следующего прогона", async () => {
    const api = fakeApi(state());
    const ex = fakeExchange();
    const r = await runLiveMirror({
      api,
      ex,
      now: () => NOW,
      verdictOk: true,
      keyAccepted: true,
      stopRequested: () => true,
    });
    expect(ex.placeTrade).not.toHaveBeenCalled();
    expect(api.claim).not.toHaveBeenCalled();
    expect(r.run?.deferred).toBe(1);
  });
});

const stale = (
  over: Partial<LiveMirrorState["stalePending"][number]> = {},
): LiveMirrorState["stalePending"][number] => ({
  tradeId: "p1",
  experimentId: "S98",
  market: "usdm",
  symbol: "ETHUSDT",
  direction: "long",
  openedAt: new Date(NOW - 10 * 60_000).toISOString(),
  ...over,
});

describe("сверка «потерянного» входа (pending дольше LIVE_PENDING_STALE_S)", () => {
  const seedIds = (id: string) => `bd${liveOrderSeed(id)}`;

  it("фьючерсы: вход и свой стоп на бирже — open с ссылками на свои ордера", async () => {
    const ex = fakeExchange({
      algoOrder: vi.fn(async (cid: string) =>
        cid.endsWith("-S")
          ? { algoId: 7, algoStatus: "NEW", actualOrderId: null }
          : { algoId: 8, algoStatus: "NEW", actualOrderId: null },
      ),
    });
    const r = await reconcileEntry(ex, stale());
    expect(ex.futuresOrder).toHaveBeenCalledWith(
      "ETHUSDT",
      `${seedIds("p1")}-M`,
    );
    expect(r).toMatchObject({
      tradeId: "p1",
      outcome: "open",
      entryPrice: 2000,
      quantity: 0.005,
      protectRefs: {
        market: "usdm",
        entryOrderId: 101,
        stop: { algoId: 7, clientAlgoId: `${seedIds("p1")}-S` },
        takeProfit: { algoId: 8 },
      },
    });
  });

  it("фьючерсы: вход есть, стопа нет — unprotected", async () => {
    const r = await reconcileEntry(fakeExchange(), stale());
    expect(r).toMatchObject({ outcome: "unprotected", quantity: 0.005 });
    expect(r?.message).toMatch(/без защиты/);
  });

  it("ордера входа нет — skipped с причиной", async () => {
    const r = await reconcileEntry(
      fakeExchange({ futuresOrder: vi.fn(async () => null) }),
      stale(),
    );
    expect(r).toMatchObject({ outcome: "skipped", protectRefs: null });
    expect(r?.message).toMatch(/Вход не состоялся/);
  });

  it("биржа не ответила — null (повтор следующим прогоном)", async () => {
    const r = await reconcileEntry(
      fakeExchange({
        futuresOrder: vi.fn(async () => {
          throw new Error("-1021");
        }),
      }),
      stale(),
    );
    expect(r).toBeNull();
  });

  it("спот: покупка исполнена и стоп OCO стоит — open, цена входа по сумме", async () => {
    const ex = fakeExchange({
      spotOrder: vi.fn(async (_s: string, cid: string) =>
        cid.endsWith("-W")
          ? spotOrd(301, "FILLED", 0.0001, 8.2)
          : cid.endsWith("-S")
            ? spotOrd(302, "NEW", 0, 0, 55)
            : cid.endsWith("-T")
              ? spotOrd(303, "NEW", 0, 0, 55)
              : null,
      ),
    });
    const r = await reconcileEntry(
      ex,
      stale({ market: "spot", symbol: "BTCUSDT" }),
    );
    expect(r).toMatchObject({
      outcome: "open",
      quantity: 0.0001,
      protectRefs: {
        market: "spot",
        orderListId: 55,
        stop: { orderId: 302 },
        takeProfit: { orderId: 303 },
      },
    });
    expect(r?.entryPrice).toBeCloseTo(82_000);
  });

  it("спот: стоп отменён — unprotected; покупки нет — skipped", async () => {
    const cancelled = fakeExchange({
      spotOrder: vi.fn(async (_s: string, cid: string) =>
        cid.endsWith("-M")
          ? spotOrd(311, "FILLED", 0.0001, 8.2)
          : cid.endsWith("-S")
            ? spotOrd(312, "CANCELED", 0, 0)
            : null,
      ),
    });
    expect(
      await reconcileEntry(
        cancelled,
        stale({ market: "spot", symbol: "BTCUSDT" }),
      ),
    ).toMatchObject({ outcome: "unprotected" });
    expect(
      await reconcileEntry(
        fakeExchange(),
        stale({ market: "spot", symbol: "BTCUSDT" }),
      ),
    ).toMatchObject({ outcome: "skipped" });
  });

  it("прогон: зависшие pending сверяются и уходят в приложение; ключ не принят — сверки нет", async () => {
    const api = fakeApi(state({ candidates: [], stalePending: [stale()] }));
    const r = await run(api, fakeExchange());
    expect(r.reconciled).toHaveLength(1);
    expect(api.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ tradeId: "p1", outcome: "unprotected" }),
    );

    const rejected = fakeApi(
      state({ candidates: [], stalePending: [stale()] }),
    );
    await run(rejected, fakeExchange(), {
      verdictOk: false,
      keyAccepted: false,
    });
    expect(rejected.reconcile).not.toHaveBeenCalled();
  });
});

describe("ревью PR #89, круг 2", () => {
  const exchangeClosed = {
    status: "closed" as const,
    message: "Позиция уже закрыта биржей (сработал стоп/тейк).",
    steps: [],
    exitPrice: null,
  };
  const fillsDown = vi.fn(async () => {
    throw new Error("-1003 Too many requests");
  });

  it("сработал стоп на бирже + сбой fills → оценка по своему стопу, PnL отрицательный, закрыта по SL", async () => {
    const ex = fakeExchange({
      closePosition: vi.fn(async () => exchangeClosed),
      fills: fillsDown,
    });
    const body = await closeOne(ex, { ...item, stopLoss: 1900 }, "mirror");
    expect(body.exit.pnlEstimated).toBe(true);
    expect(body.exit.exitPrice).toBe(1900);
    // long 0.005: (1900 − 2000) × 0.005 = −0,5 минус taker 0,05% с обеих сторон.
    expect(body.exit.realizedPnl).toBeCloseTo(-0.5 - 0.005 * 3900 * 0.0005);
    expect(body.exit.closedBy).toBe("sl");
    expect(body.exit.message).toMatch(/выход — цена своего стопа/);
    expect(ex.price).not.toHaveBeenCalled();
  });

  it("стоп не известен — оценка по текущей цене; цена не прочитана — PnL не посчитан", async () => {
    const ex = fakeExchange({
      closePosition: vi.fn(async () => exchangeClosed),
      fills: fillsDown,
      price: vi.fn(async () => 1950),
    });
    const body = await closeOne(ex, item, "mirror");
    expect(body.exit).toMatchObject({ exitPrice: 1950, pnlEstimated: true });
    expect(body.exit.realizedPnl).toBeLessThan(0);
    expect(body.exit.message).toMatch(/выход — текущая цена/);

    const blind = fakeExchange({
      closePosition: vi.fn(async () => exchangeClosed),
      fills: fillsDown,
      price: vi.fn(async () => {
        throw new Error("сеть");
      }),
    });
    const none = await closeOne(blind, item, "mirror");
    expect(none.exit).toMatchObject({ realizedPnl: null, pnlEstimated: false });
  });

  it("сверка: свой стоп или тейк уже сработал — open без ⚠️ (фьючерсы и спот)", async () => {
    const futures = fakeExchange({
      algoOrder: vi.fn(async (cid: string) =>
        cid.endsWith("-S")
          ? { algoId: 7, algoStatus: "FINISHED", actualOrderId: 103 }
          : { algoId: 8, algoStatus: "CANCELED", actualOrderId: null },
      ),
    });
    const f = await reconcileEntry(futures, stale());
    expect(f).toMatchObject({ outcome: "open" });
    expect(f?.message).toMatch(/закрыла биржа/);

    const spot = fakeExchange({
      spotOrder: vi.fn(async (_s: string, cid: string) =>
        cid.endsWith("-W")
          ? spotOrd(321, "FILLED", 0.0001, 8.2)
          : cid.endsWith("-S")
            ? spotOrd(322, "EXPIRED", 0, 0, 56)
            : cid.endsWith("-T")
              ? spotOrd(323, "FILLED", 0.0001, 8.8, 56)
              : null,
      ),
    });
    const s = await reconcileEntry(
      spot,
      stale({ market: "spot", symbol: "BTCUSDT" }),
    );
    expect(s).toMatchObject({ outcome: "open" });
    expect(s?.message).toMatch(/продала биржа/);
  });
});
