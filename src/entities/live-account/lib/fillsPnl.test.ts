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

  it("спот: комиссия покупки в монете уже в обороте выхода, в $ — по цене исполнения", () => {
    const r = fillsPnl(
      [
        fill(1000, "BUY", 10, 1, 0.01, "ADA"),
        fill(2000, "SELL", 9.9, 1.1, 0.01089, "USDT"),
      ],
      { direction: "long", since: 1000, baseAsset: "ADA" },
    );
    expect(r.feesUsd).toBeCloseTo(0.01 + 0.01089);
    expect(r.realizedPnl).toBeCloseTo(9.9 * 1.1 - 10 - 0.01089);
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
