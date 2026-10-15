import { describe, expect, it } from "vitest";
import {
  afterEntryError,
  afterFuturesOrderCheck,
  afterFuturesPositionCheck,
  afterFuturesRollback,
  afterFuturesStop,
  afterFuturesTakeProfit,
  afterPending,
  afterProtect,
  afterSell,
  afterSpotBuy,
  afterSpotRecheck,
  afterStopBeforeEntry,
  afterStopLost,
  afterTakeProfitCancel,
} from "./tradeOutcome";

describe("ошибка отправки входа", () => {
  it("биржа отказала — позиции нет, rejected без цены входа", () => {
    expect(afterEntryError("rejected", "futures")).toEqual({
      status: "rejected",
      message: "Биржа отклонила вход — позиция не открыта.",
      withEntry: false,
    });
    expect(afterEntryError("rejected", "spotList")).toMatchObject({
      status: "rejected",
      message: "Биржа отклонила заявку — монеты не куплены.",
    });
  });
  it("исход неизвестен (-1007, 5xx, сеть) — проверить на бирже, а не объявлять отказ", () => {
    expect(afterEntryError("unknown", "futures")).toBe("recheck");
    expect(afterEntryError("unknown", "spotList")).toBe("recheck");
    expect(afterEntryError("unknown", "spotMarket")).toBe("recheck");
  });
});

describe("фьючерсы", () => {
  it("проверка позиции после неизвестного исхода: сторона до входа пуста", () => {
    const position = { amount: 0.5, entryPrice: 100 };
    expect(afterFuturesPositionCheck(position, 0, "unknown", 0.5)).toEqual({
      protect: position,
    });
    expect(
      afterFuturesPositionCheck(
        { amount: 0, entryPrice: 0 },
        0,
        "missing",
        0.5,
      ),
    ).toMatchObject({ status: "rejected", withEntry: false });
    expect(afterFuturesPositionCheck(null, 0, "unknown", 0.5)).toMatchObject({
      status: "unprotected",
      withEntry: false,
    });
  });
  it("на стороне уже есть объём соседей (PR 2d): защищаем только свой прирост", () => {
    // Сосед держит 30, наш вход 40 → на стороне 70: защищаем 40, а не 70.
    expect(
      afterFuturesPositionCheck(
        { amount: 70, entryPrice: 0.22 },
        30,
        "unknown",
        40,
      ),
    ).toEqual({ protect: { amount: 40, entryPrice: null } });
  });
  it("соседи на стороне, свой ордер не найден и сторона не выросла — вход не прошёл, их объём не трогаем", () => {
    expect(
      afterFuturesPositionCheck(
        { amount: 30, entryPrice: 0.22 },
        30,
        "missing",
        40,
      ),
    ).toMatchObject({ status: "rejected", withEntry: false });
  });
  it("соседи на стороне, свой ордер не найден, но сторона выросла на заявку — вход исполнился, не rejected (ревью #66)", () => {
    expect(
      afterFuturesPositionCheck(
        { amount: 70, entryPrice: 0.22 },
        30,
        "missing",
        40,
      ),
    ).toEqual({ protect: { amount: 40, entryPrice: null } });
  });
  it("соседи на стороне, свой ордер не найден, прирост неясен — unprotected, не rejected", () => {
    expect(
      afterFuturesPositionCheck(
        { amount: 55, entryPrice: 0.22 },
        30,
        "missing",
        40,
      ),
    ).toMatchObject({ status: "unprotected", withEntry: false });
  });
  it("соседи на стороне, ордер не прочитан, прирост неясен — unprotected без защиты и отката", () => {
    expect(
      afterFuturesPositionCheck(
        { amount: 55, entryPrice: 0.22 },
        30,
        "unknown",
        40,
      ),
    ).toMatchObject({ status: "unprotected", withEntry: false });
  });
  it("соседи на стороне, ордер не прочитан, сторона не выросла — вход не прошёл", () => {
    // Позиция перечитана после окна исполнения ордера: прироста нет — как при пустой стороне.
    expect(
      afterFuturesPositionCheck(
        { amount: 30, entryPrice: 0.22 },
        30,
        "unknown",
        40,
      ),
    ).toMatchObject({ status: "rejected", withEntry: false });
  });
  it("стоп не встал — откат; встал — тейк или готово (stopOnly)", () => {
    expect(afterFuturesStop(false, false)).toBe("rollback");
    expect(afterFuturesStop(false, true)).toBe("rollback");
    expect(afterFuturesStop(true, false)).toBe("takeProfit");
    expect(afterFuturesStop(true, true)).toMatchObject({
      status: "protected",
      withEntry: true,
    });
  });
  it("тейк не встал при стоящем стопе — protected с ценой входа (как на споте)", () => {
    expect(afterFuturesTakeProfit(true)).toMatchObject({
      status: "protected",
      message: "Позиция открыта, TP и SL выставлены.",
    });
    expect(afterFuturesTakeProfit(false)).toMatchObject({
      status: "protected",
      message:
        "Позиция открыта, стоп стоит, тейк не выставился (выход — вместе с paper-сделкой).",
      withEntry: true,
    });
  });
  it("откат: закрыли — rejected без цены входа (не попадёт в демо-PnL), нет — тревога", () => {
    expect(afterFuturesRollback(true)).toEqual({
      status: "rejected",
      message: "Стоп не принят биржей — позиция сразу закрыта по рынку.",
      withEntry: false,
    });
    expect(afterFuturesRollback(false)).toMatchObject({
      status: "unprotected",
      withEntry: true,
    });
  });
});

describe("спот", () => {
  it("перечитанная заявка: нет на бирже — rejected, не прочитали — unprotected", () => {
    const list = { filled: 1 };
    expect(afterSpotRecheck(list)).toEqual({ found: list });
    expect(afterSpotRecheck("missing")).toMatchObject({
      status: "rejected",
      withEntry: false,
    });
    expect(afterSpotRecheck("error")).toMatchObject({
      status: "unprotected",
      withEntry: false,
    });
  });
  it("покупка: целиком, частично, FOK истёк, ещё в работе", () => {
    expect(afterSpotBuy("FILLED", 40, "spotList")).toBe("filled");
    expect(afterSpotBuy("EXPIRED", 12, "spotList")).toBe("partial");
    expect(afterSpotBuy("EXPIRED", 0, "spotList")).toMatchObject({
      status: "rejected",
      message: "Покупка не исполнилась по цене до +0,5% — монеты не куплены.",
    });
    expect(afterSpotBuy("NEW", 0, "spotMarket")).toMatchObject({
      status: "unprotected",
      withEntry: false,
    });
  });
  it("отложенные ордера: стоят, только стоп, ещё не подтверждены, сняты", () => {
    expect(afterPending("placed", false)).toMatchObject({
      status: "protected",
      message: "Позиция открыта, TP и SL выставлены.",
    });
    expect(afterPending("placed", true)).toMatchObject({
      status: "protected",
      message:
        "Позиция открыта, стоп выставлен (тейка нет — выход по стратегии).",
    });
    expect(afterPending("stopOnly", false)).toEqual({
      status: "protected",
      message: "Позиция открыта, стоп стоит, тейк снят биржей.",
      withEntry: true,
    });
    expect(afterPending("waiting", false)).toMatchObject({
      status: "unprotected",
      withEntry: true,
    });
    expect(afterPending("failed", false)).toBe("protect");
  });
  it("защита купленного: отказ — продать, неизвестно — не продавать (стоп мог встать)", () => {
    expect(afterProtect("placed", false)).toMatchObject({
      status: "protected",
    });
    expect(afterProtect("rejected", false)).toBe("sell");
    expect(afterProtect("unknown", true)).toMatchObject({
      status: "unprotected",
      withEntry: true,
    });
  });
  it("продажа после отказа защиты: продали — rejected, нет — unprotected", () => {
    expect(afterSell(true)).toMatchObject({
      status: "rejected",
      withEntry: false,
    });
    expect(afterSell(false)).toMatchObject({
      status: "unprotected",
      withEntry: true,
    });
  });
});

describe("фьючерсы: свой ордер входа после неизвестного исхода", () => {
  it("исполнен — берём объём из ордера; завершён без исполнения — отказ; иначе — по позиции", () => {
    const order = { status: "FILLED", executedQty: 40, avgPrice: 0.2292 };
    expect(afterFuturesOrderCheck(order)).toEqual({ filled: order });
    expect(
      afterFuturesOrderCheck({ status: "EXPIRED", executedQty: 0 }),
    ).toMatchObject({ status: "rejected", withEntry: false });
    expect(afterFuturesOrderCheck({ status: "NEW", executedQty: 0 })).toBe(
      "checkPosition",
    );
    expect(afterFuturesOrderCheck(null)).toBe("checkPosition");
    expect(afterFuturesOrderCheck("error")).toBe("checkPosition");
  });
});

describe("спот: стоп OTOCO снят биржей, тейк ещё стоит (PR 2b)", () => {
  it("тейк стоит — снять свой тейк, потом защищать заново", () => {
    expect(afterStopLost({ status: "NEW", executedQty: 0 })).toBe(
      "cancelTakeProfit",
    );
    expect(afterStopLost({ status: "PARTIALLY_FILLED", executedQty: 10 })).toBe(
      "cancelTakeProfit",
    );
  });
  it("тейк исполнен — монеты проданы, защита не нужна", () => {
    expect(afterStopLost({ status: "FILLED", executedQty: 59 })).toMatchObject({
      status: "protected",
      withEntry: true,
    });
  });
  it("тейк снят или не найден — защищать сразу", () => {
    expect(afterStopLost({ status: "EXPIRED", executedQty: 0 })).toBe(
      "protect",
    );
    expect(afterStopLost(null)).toBe("protect");
  });
  it("снять тейк не удалось — без продажи и перезащиты, unprotected", () => {
    expect(afterTakeProfitCancel(true)).toBe("protect");
    expect(afterTakeProfitCancel(false)).toMatchObject({
      status: "unprotected",
      withEntry: true,
    });
  });
});

describe("фьючерсы: «стоп до входа» (AC10)", () => {
  it("стоп не принят — вход не отправляется, rejected без цены", () => {
    expect(afterStopBeforeEntry(true)).toBe("enter");
    expect(afterStopBeforeEntry(false)).toEqual({
      status: "rejected",
      message: "Стоп не принят биржей — вход не отправлялся.",
      withEntry: false,
    });
  });
});
