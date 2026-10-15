import { describe, expect, it } from "vitest";
import {
  isEligibleSymbol,
  type MarketTicker,
  pickUniverse,
} from "./universe.ts";

const t = (
  symbol: string,
  quoteVolume: number,
  priceChangePercent = 0,
): MarketTicker => ({ symbol, lastPrice: 1, priceChangePercent, quoteVolume });

const tickers = [
  t("BTCUSDT", 5e9, 1),
  t("ETHUSDT", 3e9, -2),
  t("USDCUSDT", 9e9),
  t("BTCUPUSDT", 1e8),
  t("ETHBTC", 1e9),
  t("BTCUSDT_251226", 1e9),
  t("PIXELUSDT", 4e7, 30),
  t("OPUSDT", 6e7, -25),
  t("DOGEUSDT", 1e9, 5),
  t("TINYUSDT", 1e5, 80),
];

describe("юниверс", () => {
  it("без стейблкоинов, плечевых токенов, не-USDT и поставочных фьючерсов", () => {
    expect(isEligibleSymbol("BTCUSDT")).toBe(true);
    expect(isEligibleSymbol("USDCUSDT")).toBe(false);
    expect(isEligibleSymbol("BTCUPUSDT")).toBe(false);
    expect(isEligibleSymbol("ETHBEARUSDT")).toBe(false);
    expect(isEligibleSymbol("ETHBTC")).toBe(false);
    expect(isEligibleSymbol("BTCUSDT_251226")).toBe(false);
  });

  it("top-N по обороту", () => {
    expect(pickUniverse({ type: "top", n: 3 }, tickers)).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "DOGEUSDT",
    ]);
  });

  it("movers: лидеры роста и падения среди ликвидных", () => {
    expect(pickUniverse({ type: "movers", n: 1 }, tickers)).toEqual([
      "PIXELUSDT",
      "OPUSDT",
    ]);
  });

  it("majors и symbols — только торгуемые; blacklist базой или символом", () => {
    expect(pickUniverse({ type: "majors" }, tickers)).toEqual([
      "BTCUSDT",
      "ETHUSDT",
    ]);
    expect(
      pickUniverse({ type: "symbols", symbols: ["doge", "XYZUSDT"] }, tickers),
    ).toEqual(["DOGEUSDT"]);
    expect(
      pickUniverse(
        { type: "movers", n: 2, blacklist: ["PIXEL", "OPUSDT"] },
        tickers,
      ),
    ).toEqual(["DOGEUSDT", "BTCUSDT", "ETHUSDT"]);
  });

  it("без токенизированных акций и металлов: не попадают ни в top, ни в movers (spec 0029)", () => {
    const market = [
      ...tickers,
      t("SNDKBUSDT", 9e9, 40),
      t("SOXLBUSDT", 8e9, -40),
      t("CRCLBUSDT", 7e9, 35),
      t("SPCXBUSDT", 6e9, -35),
      t("PAXGUSDT", 6e9, 2),
      t("XAUTUSDT", 6e9, -2),
      t("XAUUSDT", 6e9, 1),
    ];
    expect(isEligibleSymbol("PAXGUSDT")).toBe(false);
    expect(isEligibleSymbol("TSLABUSDT")).toBe(false);
    // Крипта с B на конце — не акция.
    expect(isEligibleSymbol("BNBUSDT")).toBe(true);
    expect(isEligibleSymbol("ARBUSDT")).toBe(true);
    expect(pickUniverse({ type: "top", n: 3 }, market)).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "DOGEUSDT",
    ]);
    expect(pickUniverse({ type: "movers", n: 1 }, market)).toEqual([
      "PIXELUSDT",
      "OPUSDT",
    ]);
    expect(
      pickUniverse({ type: "symbols", symbols: ["PAXG", "BTC"] }, market),
    ).toEqual(["BTCUSDT"]);
  });

  it("futures: PAXG и XAUT (COIN с подтипом RWA проходят справочник) отсекает NON_CRYPTO, монета RWA-сектора остаётся", () => {
    // Тикеры futures после fetchPerpetualSymbols({ cryptoOnly: true }): подтип RWA там не фильтруется.
    const futures = [
      t("BTCUSDT", 5e9, 1),
      t("PAXGUSDT", 4e9, 3),
      t("XAUTUSDT", 3e9, -3),
      t("MANTRAUSDT", 2e9, 2),
    ];
    expect(pickUniverse({ type: "top", n: 4 }, futures)).toEqual([
      "BTCUSDT",
      "MANTRAUSDT",
    ]);
    expect(pickUniverse({ type: "movers", n: 1 }, futures)).toEqual([
      "MANTRAUSDT",
      "BTCUSDT",
    ]);
  });
});
