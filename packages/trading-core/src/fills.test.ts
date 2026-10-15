import { describe, expect, it } from "vitest";
import {
  entryFill,
  exitFill,
  FEE_RATE,
  settle,
  unrealizedPnl,
} from "./fills.ts";

describe("entryFill / exitFill", () => {
  it("вход по рынку хуже цены на 0,05%", () => {
    expect(entryFill(100, "long")).toBeCloseTo(100.05);
    expect(entryFill(100, "short")).toBeCloseTo(99.95);
  });

  it("тейк — по уровню, остальные выходы — с проскальзыванием", () => {
    expect(exitFill(104, "long", "tp")).toBe(104);
    expect(exitFill(98, "long", "sl")).toBeCloseTo(97.951);
    expect(exitFill(102, "short", "trail")).toBeCloseTo(102.051);
  });
});

describe("settle", () => {
  it("spot long: комиссия 0,1% с обеих сторон и R от исходного стопа", () => {
    const s = settle({
      market: "spot",
      direction: "long",
      entryPrice: 100,
      exitPrice: 110,
      quantity: 1,
      initialStop: 95,
    });
    expect(s.fees).toBeCloseTo(0.21);
    expect(s.pnl).toBeCloseTo(9.79);
    expect(s.rMultiple).toBeCloseTo(1.958);
  });

  it("usdm short: комиссия 0,05%, прибыль при падении", () => {
    const s = settle({
      market: "usdm",
      direction: "short",
      entryPrice: 100,
      exitPrice: 90,
      quantity: 2,
      initialStop: 105,
    });
    expect(s.fees).toBeCloseTo(0.19);
    expect(s.pnl).toBeCloseTo(19.81);
    expect(s.rMultiple).toBeCloseTo(19.81 / 10);
  });

  it("убыток на стопе ≈ −1R минус комиссии; без стопа R не определён", () => {
    const loss = settle({
      market: "usdm",
      direction: "long",
      entryPrice: 100,
      exitPrice: 98,
      quantity: 1,
      initialStop: 98,
    });
    expect(loss.rMultiple).toBeCloseTo(-1.0495);
    expect(
      settle({
        market: "spot",
        direction: "long",
        entryPrice: 100,
        exitPrice: 101,
        quantity: 1,
        initialStop: null,
      }).rMultiple,
    ).toBeNull();
  });
});

describe("unrealizedPnl", () => {
  it("учитывает комиссии входа и будущего выхода", () => {
    expect(
      unrealizedPnl(
        { market: "spot", direction: "long", entryPrice: 100, quantity: 1 },
        105,
      ),
    ).toBeCloseTo(4.795);
  });

  it("coinm: PnL инверсного контракта в $ по цене выхода = линейному при qty = N × размер / вход", () => {
    // 2 контракта по $100 (BTC), вход 50 000, выход 55 000 (long).
    const contracts = 2;
    const size = 100;
    const entryPrice = 50_000;
    const exitPrice = 55_000;
    const quantity = (contracts * size) / entryPrice;
    const s = settle({
      market: "coinm",
      direction: "long",
      entryPrice,
      exitPrice,
      quantity,
      initialStop: null,
    });
    // Инверсный контракт: PnL в BTC = N × C × (1/вход − 1/выход), в $ — по цене выхода.
    const inverseUsd =
      contracts * size * (1 / entryPrice - 1 / exitPrice) * exitPrice;
    expect(s.pnl + s.fees).toBeCloseTo(inverseUsd);
    expect(s.fees).toBeCloseTo(0.0005 * quantity * (entryPrice + exitPrice));
    expect(FEE_RATE.coinm).toBe(0.0005);
  });
});
