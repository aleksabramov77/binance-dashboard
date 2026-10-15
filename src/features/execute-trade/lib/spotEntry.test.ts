import { describe, expect, it } from "vitest";
import {
  ceilToTick,
  chooseSpotEntry,
  pendingOutcome,
  spotEntryFromQuery,
  spotEntryLimitPrice,
  tradeClientIds,
} from "./spotEntry";
import { spotSellQuantity } from "./validateTrade";

describe("chooseSpotEntry", () => {
  const all = { otoAllowed: true, ocoAllowed: true };
  it("с тейком — OTOCO, без тейка — OTO", () => {
    expect(chooseSpotEntry(all, false)).toBe("otoco");
    expect(chooseSpotEntry(all, true)).toBe("oto");
  });
  it("биржа не разрешает OTO (или OCO для тейка) — покупка, потом защита", () => {
    expect(chooseSpotEntry({ ...all, otoAllowed: false }, true)).toBe("market");
    expect(chooseSpotEntry({ ...all, ocoAllowed: false }, false)).toBe(
      "market",
    );
    expect(chooseSpotEntry({ ...all, ocoAllowed: false }, true)).toBe("oto");
  });
});

describe("цена и объём составной заявки", () => {
  it("лимит покупки — +0,5% к цене, вверх к тику", () => {
    expect(spotEntryLimitPrice(0.1702, "0.00010000")).toBe("0.1711");
    expect(ceilToTick(1.0001, "0.01")).toBe("1.01");
    expect(ceilToTick(1.01, "0.01")).toBe("1.01");
  });
  it("продаём купленное за вычетом комиссии 0,1% в монете", () => {
    // Демо 2026-10-15: куплено 40 BAT, комиссия 0,04 BAT → стоп на 39 (шаг 1).
    expect(spotSellQuantity("40", "1.00000000")).toBe("39");
    expect(spotSellQuantity("930.0", "0.10000000")).toBe("929.0");
  });
});

const stop = (status: string) => ({ type: "STOP_LOSS", status });
const tp = (status: string) => ({ type: "LIMIT_MAKER", status });

describe("pendingOutcome", () => {
  it("сразу после заявки — PENDING_NEW, потом NEW", () => {
    expect(pendingOutcome([tp("PENDING_NEW"), stop("PENDING_NEW")])).toBe(
      "waiting",
    );
    expect(pendingOutcome([tp("NEW"), stop("NEW")])).toBe("placed");
    expect(pendingOutcome([stop("NEW")])).toBe("placed");
  });
  it("стоп уже сработал — тейк снят биржей, но это не отказ защиты", () => {
    expect(pendingOutcome([stop("FILLED"), tp("EXPIRED")])).toBe("placed");
  });
  it("тейк снят биржей, стоп стоит — защита есть, повторно не защищаем (ревью #48)", () => {
    expect(pendingOutcome([tp("EXPIRED"), stop("NEW")])).toBe("stopOnly");
    expect(pendingOutcome([tp("CANCELED"), stop("NEW")])).toBe("stopOnly");
    // Стоп ещё не подтверждён — ждём его, а не объявляем отказ.
    expect(pendingOutcome([tp("EXPIRED"), stop("PENDING_NEW")])).toBe(
      "waiting",
    );
  });
  it("биржа сняла стоп — монеты без защиты", () => {
    expect(pendingOutcome([tp("EXPIRED"), stop("EXPIRED")])).toBe("failed");
    expect(pendingOutcome([tp("NEW"), stop("CANCELED")])).toBe("failed");
    expect(pendingOutcome([stop("REJECTED")])).toBe("failed");
    expect(pendingOutcome([])).toBe("waiting");
  });
  it("стопа в списке нет — защита не подтверждена, никогда не placed (ревью #49)", () => {
    expect(pendingOutcome([tp("EXPIRED")])).toBe("failed");
    // OTOCO перечитана: стоп -S не найден (-2013), тейк -T стоит.
    expect(pendingOutcome([tp("NEW")])).toBe("waiting");
    expect(pendingOutcome([tp("FILLED")])).toBe("placed");
    // Тейк исполнен частично, стоп не найден — остаток без подтверждённого стопа.
    expect(pendingOutcome([tp("PARTIALLY_FILLED")])).toBe("waiting");
    expect(pendingOutcome([tp("PARTIALLY_FILLED"), stop("NEW")])).toBe(
      "placed",
    );
  });
});

describe("заявка с неизвестным исходом", () => {
  it("свои clientOrderId: короткие, из id сделки, разные у ордеров", () => {
    const ids = tradeClientIds("3f2a9c1e-7b4d-4e8f-9a01-23456789abcd");
    expect(ids).toEqual({
      list: "bd3f2a9c1e7b4d4e8f9a012345-L",
      working: "bd3f2a9c1e7b4d4e8f9a012345-W",
      stop: "bd3f2a9c1e7b4d4e8f9a012345-S",
      takeProfit: "bd3f2a9c1e7b4d4e8f9a012345-T",
      market: "bd3f2a9c1e7b4d4e8f9a012345-M",
      protectList: "bd3f2a9c1e7b4d4e8f9a012345-L2",
      protectStop: "bd3f2a9c1e7b4d4e8f9a012345-S2",
      protectTakeProfit: "bd3f2a9c1e7b4d4e8f9a012345-T2",
    });
    for (const id of Object.values(ids))
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
  });
  it("перечитанная заявка — в виде ответа биржи, комиссия по ставке 0,1%", () => {
    // Демо 2026-10-15: OTO по BATUSDT, перечитано GET /api/v3/order по clientOrderId.
    const working = {
      orderId: 98433430,
      orderListId: 4284769,
      type: "LIMIT",
      side: "BUY" as const,
      status: "FILLED",
      executedQty: 31,
      cummulativeQuoteQty: 5.2514,
    };
    const pending = {
      ...working,
      orderId: 98433431,
      type: "STOP_LOSS",
      side: "SELL" as const,
      status: "NEW",
      executedQty: 0,
      cummulativeQuoteQty: 0,
    };
    const list = spotEntryFromQuery(working, [pending]);
    expect(list).toMatchObject({
      orderListId: 4284769,
      workingStatus: "FILLED",
      workingOrderId: 98433430,
      filled: 31,
      quoteQty: 5.2514,
      pending: [{ orderId: 98433431, type: "STOP_LOSS", status: "NEW" }],
    });
    expect(list.baseCommission).toBeCloseTo(0.031);
  });
});
