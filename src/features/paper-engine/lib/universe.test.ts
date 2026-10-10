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
});
