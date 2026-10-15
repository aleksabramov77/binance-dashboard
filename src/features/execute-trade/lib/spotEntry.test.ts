import { describe, expect, it } from "vitest";
import {
  ceilToTick,
  chooseSpotEntry,
  pendingOutcome,
  spotEntryLimitPrice,
  spotSellQuantity,
} from "./spotEntry";

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

describe("pendingOutcome", () => {
  it("сразу после заявки — PENDING_NEW, потом NEW", () => {
    expect(pendingOutcome(["PENDING_NEW", "PENDING_NEW"])).toBe("waiting");
    expect(pendingOutcome(["NEW", "NEW"])).toBe("placed");
  });
  it("стоп уже сработал — тейк снят биржей, но это не отказ защиты", () => {
    expect(pendingOutcome(["FILLED", "EXPIRED"])).toBe("placed");
  });
  it("биржа сняла отложенные ордера — монеты без защиты", () => {
    expect(pendingOutcome(["EXPIRED", "EXPIRED"])).toBe("failed");
    expect(pendingOutcome(["REJECTED"])).toBe("failed");
    expect(pendingOutcome([])).toBe("waiting");
  });
});
