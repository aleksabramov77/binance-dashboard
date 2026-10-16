import { describe, expect, it } from "vitest";
import { fillsPnl } from "./fillsPnl";

const fill = (
  time: number,
  side: "BUY" | "SELL",
  qty: number,
  price: number,
  commission: number,
  commissionAsset: string,
) => ({ time, side, qty, quoteQty: qty * price, commission, commissionAsset });

describe("fillsPnl", () => {
  it("фьючерсы лонг: выход минус вход минус комиссии в USDT", () => {
    const r = fillsPnl(
      [
        fill(900, "SELL", 1, 99, 0, "USDT"), // до входа — не наша
        fill(1000, "BUY", 0.1, 100, 0.005, "USDT"),
        fill(2000, "SELL", 0.1, 108, 0.0054, "USDT"),
      ],
      { direction: "long", since: 1000, baseAsset: "ETH" },
    );
    expect(r.entryQty).toBeCloseTo(0.1);
    expect(r.exitPrice).toBeCloseTo(108);
    expect(r.feesUsd).toBeCloseTo(0.0104);
    expect(r.realizedPnl).toBeCloseTo(0.8 - 0.0104);
  });

  it("фьючерсы шорт: вход минус выход", () => {
    const r = fillsPnl(
      [
        fill(1000, "SELL", 2, 50, 0.05, "USDT"),
        fill(2000, "BUY", 2, 52, 0.052, "USDT"),
      ],
      { direction: "short", since: 1000, baseAsset: "SOL" },
    );
    expect(r.realizedPnl).toBeCloseTo(-4 - 0.102);
  });

  it("спот: PnL по проданной части, комиссия в монете — в $; остаток (пыль) — отдельно", () => {
    const r = fillsPnl(
      [
        fill(1000, "BUY", 10, 1, 0.01, "ADA"),
        fill(2000, "SELL", 9.9, 1.1, 0.01089, "USDT"),
      ],
      { direction: "long", since: 1000, baseAsset: "ADA" },
    );
    expect(r.feesUsd).toBeCloseTo(0.01 + 0.01089);
    expect(r.realizedPnl).toBeCloseTo(9.9 * 1.1 - 9.9 * 1 - 0.01 - 0.01089);
    expect(r.leftoverQty).toBeCloseTo(0.09);
    expect(r.leftoverUsd).toBeCloseTo(0.09 * 1.1);
  });

  it("спот BTC с пылью (приёмка 0049): выход выше входа — PnL не уходит в минус на остаток", () => {
    // Куплено 0,00014 BTC по 81 932,01 (комиссия 0,1% в BTC), продано 0,00013 по 82 060 (комиссия 0,1% в USDT).
    const r = fillsPnl(
      [
        fill(1000, "BUY", 0.00014, 81_932.01, 0.00000014, "BTC"),
        fill(2000, "SELL", 0.00013, 82_060, 0.00013 * 82_060 * 0.001, "USDT"),
      ],
      { direction: "long", since: 1000, baseAsset: "BTC" },
    );
    const fees = 0.00000014 * 81_932.01 + 0.00013 * 82_060 * 0.001;
    expect(r.feesUsd).toBeCloseTo(fees, 6);
    // Прибыль проданной части 0,00013 × (82 060 − 81 932,01) ≈ $0,0166 минус комиссии ≈ $0,022.
    expect(r.realizedPnl).toBeCloseTo(0.00013 * (82_060 - 81_932.01) - fees, 6);
    expect(r.realizedPnl ?? 0).toBeGreaterThan(-0.01);
    // Остаток 0,00000986 BTC ≈ $0,81 — на субсчёте, не убыток.
    expect(r.leftoverQty).toBeCloseTo(0.00000986, 10);
    expect(r.leftoverUsd).toBeCloseTo(0.00000986 * 82_060, 4);
  });

  it("выхода нет — PnL null; комиссии в BNB — отдельно, не пересчитаны", () => {
    const r = fillsPnl([fill(1000, "BUY", 1, 10, 0.001, "BNB")], {
      direction: "long",
      since: 0,
      baseAsset: "X",
    });
    expect(r.realizedPnl).toBeNull();
    expect(r.exitPrice).toBeNull();
    expect(r.unpricedFees).toEqual(["BNB"]);
  });
});
