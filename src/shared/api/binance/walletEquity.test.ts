import { describe, expect, it } from "vitest";
import { coinmBalancesSchema, futuresAccountAssetsSchema } from "./demoSchemas";
import { resolveUsdPrice } from "./prices";
import { sumUsd, walletsByMarket } from "./walletEquity";

const prices = new Map([
  ["BTCUSDT", 60_000],
  ["ETHUSDT", 3_000],
  ["NEARUSDT", 2],
]);
const price = (asset: string) => resolveUsdPrice(asset, prices);

describe("sumUsd", () => {
  it("складывает остатки × цену в $, стейблкоины — по 1", () => {
    expect(
      sumUsd(
        [
          { asset: "USDT", amount: 5_000 },
          { asset: "USDC", amount: 5_000 },
          { asset: "BTC", amount: 0.01 },
        ],
        price,
      ),
    ).toEqual({ usd: 10_600, unpriced: [] });
  });

  it("активы без цены не входят в сумму и перечисляются; нулевые остатки пропускаются", () => {
    expect(
      sumUsd(
        [
          { asset: "ETH", amount: 1 },
          { asset: "SNDKB", amount: 3 },
          { asset: "ZZZ", amount: 0 },
        ],
        price,
      ),
    ).toEqual({ usd: 3_000, unpriced: ["SNDKB"] });
  });

  it("отрицательный остаток (убыток больше кошелька) уменьшает сумму", () => {
    expect(sumUsd([{ asset: "USDT", amount: -10 }], price).usd).toBe(-10);
  });
});

describe("walletsByMarket", () => {
  it("раскладывает кошельки Spot, USDⓈ-M и COIN-M, остальные игнорирует", () => {
    expect(
      walletsByMarket([
        { walletName: "Spot", balance: 120.5 },
        { walletName: "Funding", balance: 50 },
        { walletName: "USDⓈ-M Futures", balance: 0 },
        { walletName: "COIN-M Futures", balance: 7 },
        { walletName: "Earn", balance: 1_000 },
      ]),
    ).toEqual({ spot: 120.5, usdm: 0, coinm: 7 });
  });

  it("кошелька нет в ответе — null", () => {
    expect(walletsByMarket([{ walletName: "Spot", balance: 1 }])).toEqual({
      spot: 1,
      usdm: null,
      coinm: null,
    });
  });
});

describe("схемы балансов демо-фьючерсов", () => {
  it("USDⓈ-M: walletBalance и unrealizedProfit числами из строк (ответ пробы 2026-10-16)", () => {
    const parsed = futuresAccountAssetsSchema.parse({
      totalWalletBalance: "4920.2",
      assets: [
        {
          asset: "USDT",
          walletBalance: "4920.20634549",
          unrealizedProfit: "3.74975849",
          marginBalance: "4923.95610398",
        },
      ],
      positions: [],
    });
    expect(parsed.assets[0]).toMatchObject({
      asset: "USDT",
      walletBalance: 4920.20634549,
      unrealizedProfit: 3.74975849,
    });
  });

  it("COIN-M: balance и crossUnPnl в монете", () => {
    const [row] = coinmBalancesSchema.parse([
      {
        accountAlias: "x",
        asset: "NEAR",
        balance: "90.00000000",
        crossUnPnl: "-1.5",
        availableBalance: "90",
      },
    ]);
    expect(row).toMatchObject({ asset: "NEAR", balance: 90, crossUnPnl: -1.5 });
  });
});
