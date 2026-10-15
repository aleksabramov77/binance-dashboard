import { describe, expect, it } from "vitest";
import {
  algoLeg,
  averagePrice,
  ownCloseQuantity,
  planOwnClose,
  positionOnSide,
  spotLeg,
  spotNetQuantity,
} from "./closePlan";

describe("свои ордера фьючерсов (algo)", () => {
  it("NEW — стоит, снимаем; сработавший — по actualOrderId или статусу", () => {
    expect(algoLeg({ algoStatus: "NEW", actualOrderId: null })).toEqual({
      active: true,
      triggered: false,
      executedQty: 0,
    });
    expect(
      algoLeg({ algoStatus: "FINISHED", actualOrderId: 77 }),
    ).toMatchObject({ active: false, triggered: true });
    expect(
      algoLeg({ algoStatus: "TRIGGERED", actualOrderId: null }),
    ).toMatchObject({ triggered: true });
    expect(algoLeg({ algoStatus: "CANCELED", actualOrderId: null })).toEqual({
      active: false,
      triggered: false,
      executedQty: 0,
    });
    expect(algoLeg(null)).toMatchObject({ active: false, triggered: false });
  });
});

describe("свои ордера спота", () => {
  it("FILLED — монеты проданы; частично исполненный тейк — снять и учесть проданное", () => {
    expect(spotLeg({ status: "FILLED", executedQty: 39 })).toEqual({
      active: false,
      triggered: true,
      executedQty: 39,
    });
    expect(spotLeg({ status: "PARTIALLY_FILLED", executedQty: 10 })).toEqual({
      active: true,
      triggered: false,
      executedQty: 10,
    });
    expect(spotLeg({ status: "NEW", executedQty: 0 })).toMatchObject({
      active: true,
    });
    expect(spotLeg({ status: "EXPIRED", executedQty: 0 })).toMatchObject({
      active: false,
      triggered: false,
    });
  });
});

describe("planOwnClose", () => {
  it("оба стоят — снять оба, докрыть самим", () => {
    const live = algoLeg({ algoStatus: "NEW", actualOrderId: null });
    expect(planOwnClose({ stop: live, takeProfit: live })).toEqual({
      cancel: ["stop", "takeProfit"],
      closedByExchange: false,
      soldByLegs: 0,
    });
  });
  it("сработал стоп — позицию закрыла биржа, висящий тейк снять", () => {
    expect(
      planOwnClose({
        stop: algoLeg({ algoStatus: "FINISHED", actualOrderId: 5 }),
        takeProfit: algoLeg({ algoStatus: "NEW", actualOrderId: null }),
      }),
    ).toEqual({
      cancel: ["takeProfit"],
      closedByExchange: true,
      soldByLegs: 0,
    });
  });
  it("без тейка (stopOnly) и с частично исполненным тейком спота", () => {
    expect(
      planOwnClose({
        stop: spotLeg({ status: "NEW", executedQty: 0 }),
        takeProfit: null,
      }),
    ).toEqual({ cancel: ["stop"], closedByExchange: false, soldByLegs: 0 });
    expect(
      planOwnClose({
        stop: spotLeg({ status: "NEW", executedQty: 0 }),
        takeProfit: spotLeg({ status: "PARTIALLY_FILLED", executedQty: 10 }),
      }),
    ).toMatchObject({ cancel: ["stop", "takeProfit"], soldByLegs: 10 });
  });
});

describe("сколько докрывать своим ордером", () => {
  it("свой объём, не больше позиции/баланса, минус проданное своими ордерами", () => {
    expect(ownCloseQuantity(0.5, 0, 1.5)).toBe(0.5);
    expect(ownCloseQuantity(0.5, 0, 0.2)).toBe(0.2);
    expect(ownCloseQuantity(40, 10, 39.96)).toBe(30);
    expect(ownCloseQuantity(40, 45, 10)).toBe(0);
  });
  it("позиция фьючерсов — только в сторону сделки", () => {
    expect(positionOnSide(0.5, "long")).toBe(0.5);
    expect(positionOnSide(-0.5, "long")).toBe(0);
    expect(positionOnSide(-0.5, "short")).toBe(0.5);
  });
});

describe("свой объём спота — полученное нетто, а не купленное", () => {
  it("комиссия в монете из fills входа; нет — по ставке 0,1%", () => {
    // Демо 2026-10-15: куплено 150 S, комиссия 0,15 S → своих 149,85.
    expect(spotNetQuantity(149.85, 150)).toBe(149.85);
    expect(spotNetQuantity(undefined, 150)).toBeCloseTo(149.85, 9);
    expect(spotNetQuantity(null, 40)).toBeCloseTo(39.96, 9);
  });
  it("закрытие не продаёт чужие монеты: баланс больше своего — продаём своё", () => {
    // На балансе 0,1436 S было до сделки: 149,9936 — продаём только свои 149,85.
    expect(ownCloseQuantity(spotNetQuantity(149.85, 150), 0, 149.9936)).toBe(
      149.85,
    );
    // Тейк уже продал часть своих.
    expect(ownCloseQuantity(spotNetQuantity(39.96, 40), 10, 40.5)).toBeCloseTo(
      29.96,
      9,
    );
  });
});

describe("averagePrice", () => {
  it("без хвоста плавающей точки", () => {
    expect(averagePrice(8.884, 40)).toBe(0.2221);
    expect(averagePrice(10.182, 60)).toBe(0.1697);
  });
});
