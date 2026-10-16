import { describe, expect, it } from "vitest";
import { createMarketApi } from "./marketApi.ts";

const kline = [1_000, "1", "2", "0.5", "1.5", "10", 60_999];

function api() {
  const urls: string[] = [];
  const market = createMarketApi(async (url) => {
    urls.push(url);
    return [kline];
  });
  return { urls, market };
}

describe("fetchKlines", () => {
  it("без startTime — последние limit свечей, как раньше", async () => {
    const { urls, market } = api();
    const [c] = await market.fetchKlines("spot", "BTCUSDT", "1m", 5);
    expect(urls).toEqual([
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=5",
    ]);
    expect(c).toMatchObject({ openTime: 1_000, high: 2, low: 0.5 });
  });

  it("со startTime — передаёт его Binance", async () => {
    const { urls, market } = api();
    await market.fetchKlines("usdm", "ETHUSDT", "1m", 1000, 1_700_000_000_000);
    expect(urls).toEqual([
      "https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=1m&limit=1000&startTime=1700000000000",
    ]);
  });
});

describe("fetchPerpetualSymbols", () => {
  const contract = (
    symbol: string,
    underlyingType: string,
    underlyingSubType: string[],
    contractType = "PERPETUAL",
  ) => ({
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    quoteAsset: "USDT",
    contractType,
    status: "TRADING",
    underlyingType,
    underlyingSubType,
  });
  const market = createMarketApi(async () => ({
    symbols: [
      contract("BTCUSDT", "COIN", ["PoW", "Crypto"]),
      contract("ETHUSDT", "COIN", ["Layer-1", "Crypto"]),
      contract("BTCDOMUSDT", "INDEX", ["Index", "Crypto"]),
      contract("PAXGUSDT", "COIN", ["RWA", "Crypto"]),
      contract("MANTRAUSDT", "COIN", ["RWA", "Crypto"]),
      contract("NEWUSDT", "PREMARKET", []),
      contract("TSLAUSDT", "EQUITY", ["TradFi"], "TRADIFI_PERPETUAL"),
    ],
  }));

  it("по умолчанию — все бессрочные USDT-контракты, как раньше", async () => {
    expect([...(await market.fetchPerpetualSymbols())]).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "BTCDOMUSDT",
      "PAXGUSDT",
      "MANTRAUSDT",
      "NEWUSDT",
    ]);
  });

  it("cryptoOnly — без индексов, пре-маркета и акций; подтип RWA не исключает (PAXG — забота NON_CRYPTO)", async () => {
    expect([
      ...(await market.fetchPerpetualSymbols({ cryptoOnly: true })),
    ]).toEqual(["BTCUSDT", "ETHUSDT", "PAXGUSDT", "MANTRAUSDT"]);
  });
});

describe("fetchPerpetuals: COIN-M (dapi, spec 0023)", () => {
  // Форма dapi: статус — contractStatus, размер контракта — contractSize, underlyingType тоже есть.
  const coinm = (
    symbol: string,
    underlyingType: string,
    contractType = "PERPETUAL",
  ) => ({
    symbol,
    baseAsset: symbol.replace(/USD_.*$/, ""),
    quoteAsset: "USD",
    contractType,
    contractStatus: "TRADING",
    contractSize: symbol.startsWith("BTC") ? 100 : 10,
    underlyingType,
  });
  const urls: string[] = [];
  const market = createMarketApi(async (url) => {
    urls.push(url);
    return {
      symbols: [
        coinm("BTCUSD_PERP", "COIN"),
        coinm("ETHUSD_PERP", "COIN"),
        coinm("BTCUSD_251226", "COIN", "CURRENT_QUARTER"),
        coinm("DEFIUSD_PERP", "INDEX"),
      ],
    };
  });

  it("бессрочные к USD со статусом из contractStatus и размером контракта; cryptoOnly — только COIN", async () => {
    expect([...(await market.fetchPerpetuals("coinm"))]).toEqual([
      ["BTCUSD_PERP", 100],
      ["ETHUSD_PERP", 10],
      ["DEFIUSD_PERP", 10],
    ]);
    expect([
      ...(await market.fetchPerpetuals("coinm", { cryptoOnly: true })),
    ]).toEqual([
      ["BTCUSD_PERP", 100],
      ["ETHUSD_PERP", 10],
    ]);
    expect(urls[0]).toBe("https://dapi.binance.com/dapi/v1/exchangeInfo");
  });
});
