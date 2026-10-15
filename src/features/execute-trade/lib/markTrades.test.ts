import { describe, expect, it } from "vitest";
import type { OrderAggregate } from "./groupFills";
import { markTrades, type SymbolState } from "./markTrades";

let nextId = 1;
const order = (over: Partial<OrderAggregate>): OrderAggregate => ({
  market: "futures",
  symbol: "BATUSDT",
  orderId: nextId++,
  side: "SELL",
  time: 0,
  quantity: 100,
  avgPrice: 1,
  quoteQty: 100,
  commissions: [],
  realizedPnl: 0,
  positionSide: "BOTH",
  ...over,
});

const state = (over: Partial<SymbolState> = {}): SymbolState => ({
  closeKinds: new Map(),
  openStops: [],
  groups: new Map(),
  fullExits: new Set(),
  position: null,
  ...over,
});

const statusOf = (marks: ReturnType<typeof markTrades>, o: OrderAggregate) =>
  marks.get(o.orderId)?.status;

describe("markTrades — futures", () => {
  it("шорт, закрытый по SL: у входа и выхода один статус «sl»", () => {
    const entry = order({ side: "SELL", time: 1 });
    const exit = order({ side: "BUY", time: 2, realizedPnl: -2.71 });
    const marks = markTrades(
      [exit, entry],
      state({ closeKinds: new Map([[exit.orderId, "sl"]]) }),
    );
    expect(statusOf(marks, entry)).toBe("sl");
    expect(statusOf(marks, exit)).toBe("sl");
    expect(marks.get(entry.orderId)?.role).toBe("entry");
    expect(marks.get(exit.orderId)?.role).toBe("exit");
  });

  it("TP → «tp», стоп в плюс → «stop-profit»", () => {
    const e1 = order({ time: 1 });
    const x1 = order({ side: "BUY", time: 2, realizedPnl: 5 });
    const e2 = order({ time: 3 });
    const x2 = order({ side: "BUY", time: 4, realizedPnl: 1 });
    const marks = markTrades(
      [e1, x1, e2, x2],
      state({
        closeKinds: new Map([
          [x1.orderId, "tp"],
          [x2.orderId, "sl"],
        ]),
      }),
    );
    expect(statusOf(marks, e1)).toBe("tp");
    expect(statusOf(marks, e2)).toBe("stop-profit");
  });

  it("ручное закрытие: по знаку итогового PnL, частичные выходы суммируются", () => {
    const entry = order({ time: 1, quantity: 100 });
    const part = order({ side: "BUY", time: 2, quantity: 40, realizedPnl: 3 });
    const rest = order({ side: "BUY", time: 3, quantity: 60, realizedPnl: -1 });
    const marks = markTrades([entry, part, rest], state());
    expect(statusOf(marks, entry)).toBe("manual-profit");
    expect(statusOf(marks, rest)).toBe("manual-profit");
  });

  it("ликвидация", () => {
    const entry = order({ time: 1 });
    const exit = order({ side: "BUY", time: 2, realizedPnl: -50 });
    const marks = markTrades(
      [entry, exit],
      state({ closeKinds: new Map([[exit.orderId, "liquidation"]]) }),
    );
    expect(statusOf(marks, entry)).toBe("liquidation");
  });

  it("открытая позиция: стоп в зоне убытка → «open», с SL и uPnL", () => {
    const entry = order({ time: 1, avgPrice: 0.0139 });
    const marks = markTrades(
      [entry],
      state({
        position: { amount: -100, entryPrice: 0.0139, unrealizedPnl: 2.4 },
        openStops: [
          { side: "BUY", triggerPrice: 0.0147, trailing: false, group: null },
        ],
      }),
    );
    expect(marks.get(entry.orderId)).toMatchObject({
      status: "open",
      stopPrice: 0.0147,
      unrealizedPnl: 2.4,
    });
  });

  it("открытая без стопа → «open-unprotected»; стоп ниже входа шорта → «open-trailing»", () => {
    const entry = order({ time: 1 });
    const position = { amount: -100, entryPrice: 1, unrealizedPnl: 0 };
    expect(statusOf(markTrades([entry], state({ position })), entry)).toBe(
      "open-unprotected",
    );
    const trailing = markTrades(
      [entry],
      state({
        position,
        openStops: [
          { side: "BUY", triggerPrice: 0.95, trailing: false, group: null },
        ],
      }),
    );
    expect(statusOf(trailing, entry)).toBe("open-trailing");
    const trailingOrder = markTrades(
      [entry],
      state({
        position,
        openStops: [
          { side: "BUY", triggerPrice: 1.2, trailing: true, group: null },
        ],
      }),
    );
    expect(statusOf(trailingOrder, entry)).toBe("open-trailing");
  });

  it("история говорит «открыта», а позиции на бирже нет → «unknown»", () => {
    const entry = order({ time: 1 });
    expect(statusOf(markTrades([entry], state()), entry)).toBe("unknown");
  });

  it("выход без входа в истории (обрезана) — сделка по выходу", () => {
    const exit = order({ side: "BUY", time: 1, realizedPnl: -3 });
    const marks = markTrades(
      [exit],
      state({ closeKinds: new Map([[exit.orderId, "sl"]]) }),
    );
    expect(statusOf(marks, exit)).toBe("sl");
    expect(marks.get(exit.orderId)?.role).toBe("exit");
  });

  it("стоп противоположной стороны (забытый от прошлого шорта) не защищает лонг", () => {
    const entry = order({ side: "BUY", time: 1, avgPrice: 1 });
    const marks = markTrades(
      [entry],
      state({
        position: { amount: 100, entryPrice: 1, unrealizedPnl: 0 },
        openStops: [
          { side: "BUY", triggerPrice: 1.3, trailing: false, group: null },
        ],
      }),
    );
    expect(marks.get(entry.orderId)).toMatchObject({
      status: "open-unprotected",
      stopPrice: null,
    });
  });

  it("лонг: берётся самый высокий из своих стопов; ниже входа — «open»", () => {
    const entry = order({ side: "BUY", time: 1, avgPrice: 1 });
    const marks = markTrades(
      [entry],
      state({
        position: { amount: 100, entryPrice: 1, unrealizedPnl: 0 },
        openStops: [
          { side: "SELL", triggerPrice: 0.9, trailing: false, group: null },
          { side: "SELL", triggerPrice: 0.95, trailing: false, group: null },
        ],
      }),
    );
    expect(marks.get(entry.orderId)).toMatchObject({
      status: "open",
      stopPrice: 0.95,
    });
  });

  it("trailing до активации (триггер 0): защищена, но цену SL не показываем", () => {
    const entry = order({ time: 1 });
    const marks = markTrades(
      [entry],
      state({
        position: { amount: -100, entryPrice: 1, unrealizedPnl: 0 },
        openStops: [
          { side: "BUY", triggerPrice: 0, trailing: true, group: null },
        ],
      }),
    );
    expect(marks.get(entry.orderId)).toMatchObject({
      status: "open-trailing",
      stopPrice: null,
    });
  });

  it("закрытая и следом открытая сделка по одному символу — разные статусы", () => {
    const e1 = order({ time: 1 });
    const x1 = order({ side: "BUY", time: 2, realizedPnl: -1 });
    const e2 = order({ time: 3 });
    const marks = markTrades(
      [e2, x1, e1],
      state({
        closeKinds: new Map([[x1.orderId, "sl"]]),
        position: { amount: -100, entryPrice: 1, unrealizedPnl: 0 },
        openStops: [
          { side: "BUY", triggerPrice: 1.1, trailing: false, group: null },
        ],
      }),
    );
    expect(statusOf(marks, e1)).toBe("sl");
    expect(statusOf(marks, x1)).toBe("sl");
    expect(statusOf(marks, e2)).toBe("open");
  });

  it("частичный выход при открытой позиции — сделка ещё открыта, выход с ролью exit", () => {
    const entry = order({ time: 1, quantity: 100 });
    const part = order({ side: "BUY", time: 2, quantity: 40, realizedPnl: 2 });
    const marks = markTrades(
      [entry, part],
      state({
        position: { amount: -60, entryPrice: 1, unrealizedPnl: 1 },
        openStops: [
          { side: "BUY", triggerPrice: 1.1, trailing: false, group: null },
        ],
      }),
    );
    expect(marks.get(part.orderId)).toMatchObject({
      status: "open",
      role: "exit",
    });
    expect(statusOf(marks, entry)).toBe("open");
  });

  it("разворот одним ордером: шорт закрыт, остаток — новая сделка (лонг)", () => {
    const short = order({ side: "SELL", time: 1, quantity: 10 });
    const flip = order({
      side: "BUY",
      time: 2,
      quantity: 15,
      avgPrice: 1,
      realizedPnl: -0.5,
    });
    const marks = markTrades(
      [short, flip],
      state({
        position: { amount: 5, entryPrice: 1, unrealizedPnl: 0 },
        openStops: [
          { side: "SELL", triggerPrice: 0.9, trailing: false, group: null },
        ],
      }),
    );
    expect(statusOf(marks, short)).toBe("manual-loss");
    expect(marks.get(flip.orderId)).toMatchObject({
      status: "open",
      role: "exit",
      pnl: -0.5,
    });
  });

  it("данные для статуса не загрузились → «unknown»", () => {
    const entry = order({ time: 1 });
    expect(statusOf(markTrades([entry], null), entry)).toBe("unknown");
  });
});

describe("markTrades — spot", () => {
  const spot = (over: Partial<OrderAggregate>) =>
    order({ market: "spot", symbol: "ETHUSDT", realizedPnl: null, ...over });

  it("PnL выхода считается от средней цены входа; пыль от комиссии — сделка закрыта", () => {
    const buy = spot({
      side: "BUY",
      time: 1,
      quantity: 1,
      avgPrice: 100,
      quoteQty: 100,
    });
    const sell = spot({
      side: "SELL",
      time: 2,
      quantity: 0.999,
      avgPrice: 110,
    });
    const marks = markTrades(
      [buy, sell],
      state({ closeKinds: new Map([[sell.orderId, "tp"]]) }),
    );
    expect(statusOf(marks, buy)).toBe("tp");
    expect(marks.get(sell.orderId)?.pnl).toBeCloseTo(9.99);
  });

  it("продажа больше купленного в истории — сделка закрыта, фантомной новой нет", () => {
    const buy = spot({
      side: "BUY",
      time: 1,
      quantity: 10,
      avgPrice: 100,
      quoteQty: 1000,
    });
    const sell = spot({ side: "SELL", time: 2, quantity: 15, avgPrice: 110 });
    const marks = markTrades(
      [buy, sell],
      state({
        closeKinds: new Map([[sell.orderId, "tp"]]),
        position: { amount: 3, entryPrice: null, unrealizedPnl: null },
      }),
    );
    expect(statusOf(marks, buy)).toBe("tp");
    expect(marks.get(sell.orderId)).toMatchObject({
      status: "tp",
      role: "exit",
    });
  });

  it("покупка без продажи и без монеты на балансе (сброс счёта) → «unknown»", () => {
    const buy = spot({ side: "BUY", time: 1, quantity: 0.008 });
    expect(statusOf(markTrades([buy], state()), buy)).toBe("unknown");
  });

  it("покупка, монета на балансе, стоит OCO-стоп → «open»", () => {
    const buy = spot({
      side: "BUY",
      time: 1,
      quantity: 1,
      avgPrice: 100,
      quoteQty: 100,
    });
    const marks = markTrades(
      [buy],
      state({
        position: { amount: 0.999, entryPrice: null, unrealizedPnl: null },
        openStops: [
          { side: "SELL", triggerPrice: 95, trailing: false, group: null },
        ],
      }),
    );
    expect(statusOf(marks, buy)).toBe("open");
  });
});

describe("markTrades — несколько сделок дашборда по одной монете (spec 0012, PR 2d)", () => {
  it("два зеркала-лонга одной монеты не склеиваются: у каждого свой выход и статус", () => {
    const a1 = order({ side: "BUY", time: 1, quantity: 40 });
    const b1 = order({ side: "BUY", time: 2, quantity: 30 });
    const aTp = order({ side: "SELL", time: 3, quantity: 40, realizedPnl: 2 });
    const marks = markTrades(
      [a1, b1, aTp],
      state({
        groups: new Map([
          [a1.orderId, "bda"],
          [b1.orderId, "bdb"],
          [aTp.orderId, "bda"],
        ]),
        closeKinds: new Map([[aTp.orderId, "tp"]]),
        openStops: [
          { side: "SELL", triggerPrice: 0.9, trailing: false, group: "bdb" },
        ],
        position: { amount: 30, entryPrice: 1, unrealizedPnl: 0 },
      }),
    );
    expect(statusOf(marks, a1)).toBe("tp");
    expect(statusOf(marks, aTp)).toBe("tp");
    // Вторая сделка открыта и защищена своим стопом.
    expect(statusOf(marks, b1)).toBe("open");
    expect(marks.get(b1.orderId)?.stopPrice).toBe(0.9);
  });

  it("чужой стоп соседнего зеркала не считается защитой своей сделки", () => {
    const a1 = order({ side: "BUY", time: 1, quantity: 40 });
    const marks = markTrades(
      [a1],
      state({
        groups: new Map([[a1.orderId, "bda"]]),
        openStops: [
          { side: "SELL", triggerPrice: 0.9, trailing: false, group: "bdb" },
        ],
        position: { amount: 70, entryPrice: 1, unrealizedPnl: 0 },
      }),
    );
    expect(statusOf(marks, a1)).toBe("open-unprotected");
  });

  it("выход без своего id (закрытие до PR 2d) закрывает открытую сделку дашборда, а не висит отдельно", () => {
    const a1 = order({ side: "BUY", time: 1, quantity: 40 });
    const manual = order({
      side: "SELL",
      time: 2,
      quantity: 40,
      realizedPnl: -1,
    });
    const marks = markTrades(
      [a1, manual],
      state({ groups: new Map([[a1.orderId, "bda"]]) }),
    );
    expect(statusOf(marks, a1)).toBe("manual-loss");
    expect(marks.get(manual.orderId)?.role).toBe("exit");
  });

  it("выход без своего id при нескольких открытых — к самой поздней (старое закрытие до PR 2d)", () => {
    const old = order({ side: "BUY", time: 1, quantity: 40 });
    const recent = order({ side: "BUY", time: 2, quantity: 40 });
    const exit = order({ side: "SELL", time: 3, quantity: 40, realizedPnl: 1 });
    const marks = markTrades(
      [old, recent, exit],
      state({
        groups: new Map([
          [old.orderId, "bdold"],
          [recent.orderId, "bdnew"],
        ]),
      }),
    );
    expect(statusOf(marks, recent)).toBe("manual-profit");
    expect(statusOf(marks, old)).toBe("unknown");
  });

  it("Hedge: лонг и шорт одной монеты — разные сделки, позиция по своей стороне", () => {
    const l = order({ side: "BUY", time: 1, positionSide: "LONG" });
    const sh = order({ side: "SELL", time: 2, positionSide: "SHORT" });
    const marks = markTrades(
      [l, sh],
      state({
        position: {
          amount: 0,
          entryPrice: 1,
          unrealizedPnl: 0,
          bySide: { LONG: 100, SHORT: -100 },
        },
        openStops: [
          { side: "SELL", triggerPrice: 0.9, trailing: false, group: null },
          { side: "BUY", triggerPrice: 1.1, trailing: false, group: null },
        ],
      }),
    );
    expect(statusOf(marks, l)).toBe("open");
    expect(statusOf(marks, sh)).toBe("open");
    expect(marks.get(sh.orderId)?.role).toBe("entry");
  });
});

describe("markTrades — спот-зеркала закрыты своим ордером, хвост нетто остаётся (PR 2d)", () => {
  const spot = (over: Partial<OrderAggregate>) =>
    order({ market: "spot", symbol: "BATUSDT", realizedPnl: null, ...over });

  it("два зеркала: продано нетто вниз к шагу (39 из 40, 44 из 45), общий баланс больше — обе закрыты", () => {
    const a = spot({ side: "BUY", time: 1, quantity: 40, quoteQty: 7 });
    const b = spot({ side: "BUY", time: 2, quantity: 45, quoteQty: 7.9 });
    const aC = spot({
      side: "SELL",
      time: 3,
      quantity: 39,
      quoteQty: 6.9,
      avgPrice: 0.177,
    });
    const bC = spot({
      side: "SELL",
      time: 4,
      quantity: 44,
      quoteQty: 7.8,
      avgPrice: 0.177,
    });
    const marks = markTrades(
      [a, b, aC, bC],
      state({
        groups: new Map([
          [a.orderId, "bda"],
          [b.orderId, "bdb"],
          [aC.orderId, "bda"],
          [bC.orderId, "bdb"],
        ]),
        fullExits: new Set([aC.orderId, bC.orderId]),
        // Хвосты двух сделок и чужие монеты: 1,9 BAT + 3,7 — «держится» по старому правилу.
        position: { amount: 5.6, entryPrice: null, unrealizedPnl: null },
      }),
    );
    for (const o of [a, b, aC, bC])
      expect(statusOf(marks, o)).not.toMatch(/^open/);
    expect(marks.get(aC.orderId)?.role).toBe("exit");
  });

  it("свой выход не целиком (частичный тейк) и без стопа — сделка остаётся open-unprotected", () => {
    const a = spot({ side: "BUY", time: 1, quantity: 40, quoteQty: 7 });
    const part = spot({ side: "SELL", time: 2, quantity: 10, quoteQty: 1.9 });
    const marks = markTrades(
      [a, part],
      state({
        groups: new Map([
          [a.orderId, "bda"],
          [part.orderId, "bda"],
        ]),
        position: { amount: 30, entryPrice: null, unrealizedPnl: null },
      }),
    );
    expect(statusOf(marks, a)).toBe("open-unprotected");
  });
});
