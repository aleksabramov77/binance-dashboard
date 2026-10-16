import { describe, expect, it } from "vitest";
import {
  coinmTicker,
  isEligibleSymbol,
  type MarketTicker,
  pickUniverse,
  symbolInMarket,
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
    expect(isEligibleSymbol("BTCUSDT", "usdm")).toBe(true);
    expect(isEligibleSymbol("USDCUSDT", "usdm")).toBe(false);
    expect(isEligibleSymbol("BTCUPUSDT", "usdm")).toBe(false);
    expect(isEligibleSymbol("ETHBEARUSDT", "usdm")).toBe(false);
    expect(isEligibleSymbol("ETHBTC", "usdm")).toBe(false);
    expect(isEligibleSymbol("BTCUSDT_251226", "usdm")).toBe(false);
  });

  it("top-N по обороту", () => {
    expect(pickUniverse({ type: "top", n: 3 }, tickers, "usdm")).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "DOGEUSDT",
    ]);
  });

  it("movers: лидеры роста и падения среди ликвидных", () => {
    expect(pickUniverse({ type: "movers", n: 1 }, tickers, "usdm")).toEqual([
      "PIXELUSDT",
      "OPUSDT",
    ]);
  });

  it("majors и symbols — только торгуемые; blacklist базой или символом", () => {
    expect(pickUniverse({ type: "majors" }, tickers, "spot")).toEqual([
      "BTCUSDT",
      "ETHUSDT",
    ]);
    expect(
      pickUniverse(
        { type: "symbols", symbols: ["doge", "XYZUSDT"] },
        tickers,
        "spot",
      ),
    ).toEqual(["DOGEUSDT"]);
    expect(
      pickUniverse(
        { type: "movers", n: 2, blacklist: ["PIXEL", "OPUSDT"] },
        tickers,
        "usdm",
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
    expect(isEligibleSymbol("PAXGUSDT", "spot")).toBe(false);
    expect(isEligibleSymbol("TSLABUSDT", "spot")).toBe(false);
    // Крипта с B на конце — не акция.
    expect(isEligibleSymbol("BNBUSDT", "spot")).toBe(true);
    expect(isEligibleSymbol("ARBUSDT", "spot")).toBe(true);
    expect(pickUniverse({ type: "top", n: 3 }, market, "spot")).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "DOGEUSDT",
    ]);
    expect(pickUniverse({ type: "movers", n: 1 }, market, "spot")).toEqual([
      "PIXELUSDT",
      "OPUSDT",
    ]);
    expect(
      pickUniverse(
        { type: "symbols", symbols: ["PAXG", "BTC"] },
        market,
        "spot",
      ),
    ).toEqual(["BTCUSDT"]);
  });

  it("USDⓈ-M: PAXG и XAUT (COIN с подтипом RWA проходят справочник) отсекает NON_CRYPTO, монета RWA-сектора остаётся", () => {
    // Тикеры USDⓈ-M после fetchPerpetualSymbols({ cryptoOnly: true }): подтип RWA там не фильтруется.
    const futures = [
      t("BTCUSDT", 5e9, 1),
      t("PAXGUSDT", 4e9, 3),
      t("XAUTUSDT", 3e9, -3),
      t("MANTRAUSDT", 2e9, 2),
    ];
    expect(pickUniverse({ type: "top", n: 4 }, futures, "usdm")).toEqual([
      "BTCUSDT",
      "MANTRAUSDT",
    ]);
    expect(pickUniverse({ type: "movers", n: 1 }, futures, "usdm")).toEqual([
      "MANTRAUSDT",
      "BTCUSDT",
    ]);
  });

  describe("COIN-M (spec 0023)", () => {
    const coin = (
      symbol: string,
      volume: number,
      contractSize = 10,
      priceChangePercent = 0,
    ) =>
      coinmTicker(
        { symbol, lastPrice: 1, priceChangePercent, volume },
        contractSize,
      );
    const coinTickers = [
      coin("BTCUSD_PERP", 1e7, 100, 2),
      coin("ETHUSD_PERP", 2e7, 10, -3),
      coin("DOGEUSD_PERP", 5e6),
      coin("BTCUSD_251226", 9e9, 100),
      coin("ADAUSD_PERP", 3e6, 10, 40),
    ];

    it("символ — …USD_PERP, поставочные контракты и …USDT не подходят", () => {
      expect(isEligibleSymbol("BTCUSD_PERP", "coinm")).toBe(true);
      expect(isEligibleSymbol("BTCUSD_251226", "coinm")).toBe(false);
      expect(isEligibleSymbol("BTCUSDT", "coinm")).toBe(false);
      expect(isEligibleSymbol("BTCUSD_PERP", "usdm")).toBe(false);
      // NON_CRYPTO — во всех группах (spec 0029).
      expect(isEligibleSymbol("PAXGUSD_PERP", "coinm")).toBe(false);
    });

    it("символ режима рынка — в формате группы: BTCUSDT ↔ BTCUSD_PERP", () => {
      expect(symbolInMarket("BTCUSDT", "coinm")).toBe("BTCUSD_PERP");
      expect(symbolInMarket("BTCUSD_PERP", "coinm")).toBe("BTCUSD_PERP");
      expect(symbolInMarket("BTCUSD_PERP", "usdm")).toBe("BTCUSDT");
      expect(symbolInMarket("BTCUSDT", "spot")).toBe("BTCUSDT");
      expect(symbolInMarket("eth", "coinm")).toBe("ETHUSD_PERP");
    });

    it("оборот в $ = контракты × размер контракта; размер контракта — в тикере", () => {
      expect(coin("BTCUSD_PERP", 1e7, 100)).toMatchObject({
        quoteVolume: 1e9,
        contractSize: 100,
      });
    });

    it("top-N по обороту в $, majors и symbols — по базе с хвостом USD_PERP", () => {
      expect(pickUniverse({ type: "top", n: 2 }, coinTickers, "coinm")).toEqual(
        ["BTCUSD_PERP", "ETHUSD_PERP"],
      );
      expect(pickUniverse({ type: "majors" }, coinTickers, "coinm")).toEqual([
        "BTCUSD_PERP",
        "ETHUSD_PERP",
      ]);
      expect(
        pickUniverse(
          {
            type: "symbols",
            symbols: ["doge", "ADAUSD_PERP", "XRP"],
            blacklist: ["ADA"],
          },
          coinTickers,
          "coinm",
        ),
      ).toEqual(["DOGEUSD_PERP"]);
    });
  });
});
