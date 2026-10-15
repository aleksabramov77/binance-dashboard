import { describe, expect, it } from "vitest";
import {
  choosePositionMode,
  futuresSequence,
  ownPosition,
  ownSideBusy,
  protectiveToCancel,
  recheckStep,
  spotProtectiveToCancel,
} from "./futuresMode";

const hedgeLong = { mode: "hedge", direction: "long" } as const;
const hedgeShort = { mode: "hedge", direction: "short" } as const;
const onewayLong = { mode: "oneway", direction: "long" } as const;
const onewayShort = { mode: "oneway", direction: "short" } as const;

describe("choosePositionMode", () => {
  it("Hedge (включён вручную) — работаем в Hedge при любом флаге", () => {
    for (const auto of [false, true])
      expect(choosePositionMode("hedge", true, auto)).toEqual({
        mode: "hedge",
        enableHedge: false,
        reason: "hedge",
      });
  });
  it("автопереключение выключено — One-way даже на пустом счёте, без POST", () => {
    expect(choosePositionMode("oneway", false, false)).toEqual({
      mode: "oneway",
      enableHedge: false,
      reason: "autoHedgeOff",
    });
  });
  it("включено: пустой счёт — включить Hedge; занят или неизвестно — One-way", () => {
    expect(choosePositionMode("oneway", false, true)).toEqual({
      mode: "hedge",
      enableHedge: true,
      reason: "switch",
    });
    expect(choosePositionMode("oneway", true, true)).toMatchObject({
      mode: "oneway",
      reason: "accountBusy",
    });
    expect(choosePositionMode("oneway", null, true)).toMatchObject({
      mode: "oneway",
      reason: "busyUnknown",
    });
  });
});

describe("ownPosition", () => {
  const hedgeRows = [
    { positionSide: "LONG", amount: 40, entryPrice: 0.22 },
    { positionSide: "SHORT", amount: -10, entryPrice: 0.23 },
  ];
  it("Hedge: строка своей стороны, без знака", () => {
    expect(ownPosition(hedgeRows, hedgeLong)).toEqual({
      amount: 40,
      entryPrice: 0.22,
    });
    expect(ownPosition(hedgeRows, hedgeShort)).toEqual({
      amount: 10,
      entryPrice: 0.23,
    });
  });
  it("One-way: только если позиция в сторону сделки", () => {
    const rows = [{ positionSide: "BOTH", amount: -0.5, entryPrice: 100 }];
    expect(ownPosition(rows, onewayShort)).toEqual({
      amount: 0.5,
      entryPrice: 100,
    });
    expect(ownPosition(rows, onewayLong)).toEqual({ amount: 0, entryPrice: 0 });
    expect(ownPosition([], onewayLong).amount).toBe(0);
  });
});

const algo = (side: "BUY" | "SELL", positionSide: string, algoId: number) => ({
  algoId,
  clientAlgoId: null,
  side,
  positionSide,
  orderType: "STOP_MARKET",
});
const order = (
  side: "BUY" | "SELL",
  positionSide: string,
  orderId: number,
  reduceOnly = false,
) => ({
  orderId,
  side,
  positionSide,
  type: "LIMIT",
  reduceOnly,
  closePosition: false,
});

describe("ownSideBusy (ручной вход и зеркало)", () => {
  it("Hedge: другая сторона не мешает, своя — занята", () => {
    const state = {
      positions: [{ positionSide: "SHORT", amount: -10, entryPrice: 1 }],
      orders: [],
      algos: [algo("BUY", "SHORT", 1)],
    };
    expect(ownSideBusy(state, hedgeLong)).toBe(false);
    expect(ownSideBusy(state, hedgeShort)).toBe("busy");
  });
  it("One-way: любая позиция или ордер по символу — занято", () => {
    expect(
      ownSideBusy(
        { positions: [], orders: [order("BUY", "BOTH", 1)], algos: [] },
        onewayShort,
      ),
    ).toBe("busy");
    expect(
      ownSideBusy(
        {
          positions: [{ positionSide: "BOTH", amount: 0, entryPrice: 0 }],
          orders: [],
          algos: [],
        },
        onewayLong,
      ),
    ).toBe(false);
  });
});

describe("protectiveToCancel (старые строки без protect_refs)", () => {
  it("One-way лонг: algo SELL и reduceOnly SELL — снять; вход BUY и чужой лимит — оставить", () => {
    expect(
      protectiveToCancel(
        {
          algos: [algo("SELL", "BOTH", 1), algo("BUY", "BOTH", 2)],
          orders: [
            order("SELL", "BOTH", 10, true),
            order("SELL", "BOTH", 11, false),
            order("BUY", "BOTH", 12, false),
          ],
        },
        onewayLong,
      ),
    ).toEqual({ algoIds: [1], orderIds: [10] });
  });
  it("Hedge шорт: только BUY своей стороны SHORT; ордера LONG не трогаем", () => {
    expect(
      protectiveToCancel(
        {
          algos: [algo("BUY", "SHORT", 1), algo("SELL", "LONG", 2)],
          orders: [order("BUY", "SHORT", 10), order("SELL", "LONG", 11)],
        },
        hedgeShort,
      ),
    ).toEqual({ algoIds: [1], orderIds: [10] });
  });
  it("спот: продажи, по одной на список; покупки — чужие", () => {
    expect(
      spotProtectiveToCancel([
        { orderId: 1, orderListId: 7, side: "SELL" },
        { orderId: 2, orderListId: 7, side: "SELL" },
        { orderId: 3, orderListId: -1, side: "SELL" },
        { orderId: 4, orderListId: -1, side: "BUY" },
      ]),
    ).toEqual([1, 3]);
  });
});

describe("futuresSequence (AC10, «стоп до входа»)", () => {
  it("только Hedge и только за флагом", () => {
    expect(futuresSequence("hedge", true)).toBe("stopFirst");
    expect(futuresSequence("hedge", false)).toBe("entryFirst");
    expect(futuresSequence("oneway", true)).toBe("entryFirst");
  });
});

describe("recheckStep (общий дедлайн сделки)", () => {
  it("нашлась; «нет» после дедлайна перечитывания — окончательно", () => {
    expect(recheckStep(true, 0, 0, 6500, 60_000)).toBe("found");
    expect(recheckStep(false, 6600, 6501, 6500, 60_000)).toBe("final");
    expect(recheckStep(false, 1000, 900, 6500, 60_000)).toEqual({ wait: 1000 });
  });
  it("дедлайн сделки раньше — не окончательно (giveUp), а не «нет»", () => {
    expect(recheckStep(false, 59_500, 59_400, 65_000, 60_000)).toBe("giveUp");
  });
});

describe("ownSideBusy: вход зеркала (PR 2d)", () => {
  const longPos = {
    positions: [{ positionSide: "BOTH", amount: 40, entryPrice: 0.22 }],
    orders: [order("SELL", "BOTH", 1, true)],
    algos: [algo("SELL", "BOTH", 2)],
  };
  it("One-way: та же сторона у другого зеркала — можно; встречная — нет", () => {
    expect(ownSideBusy(longPos, onewayLong, true)).toBe(false);
    expect(ownSideBusy(longPos, onewayShort, true)).toBe("opposite");
    // Ручной вход — по-прежнему только на пустой символ.
    expect(ownSideBusy(longPos, onewayLong)).toBe("busy");
  });
  it("Hedge: зеркалу не мешает ничего", () => {
    const state = {
      positions: [
        { positionSide: "LONG", amount: 40, entryPrice: 0.22 },
        { positionSide: "SHORT", amount: -10, entryPrice: 0.23 },
      ],
      orders: [],
      algos: [],
    };
    expect(ownSideBusy(state, hedgeLong, true)).toBe(false);
    expect(ownSideBusy(state, hedgeShort, true)).toBe(false);
  });
});
