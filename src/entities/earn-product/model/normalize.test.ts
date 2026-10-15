import { describe, expect, it } from "vitest";
import type { DualProduct } from "@/shared/api/binance";
import {
  normalizeDualProducts,
  normalizeOnchainProducts,
  normalizeSummary,
  stableYieldProduct,
  stakingProduct,
} from "./normalize";

const prices = new Map([
  ["BTCUSDT", 80_884],
  ["BTCUSDC", 80_900],
  ["ETHUSDT", 3_000],
]);

const product = (p: Partial<DualProduct>): DualProduct => ({
  id: "1",
  investCoin: "BTC",
  exercisedCoin: "USDT",
  strikePrice: 81_000,
  duration: 1,
  settleDate: 1792137600000,
  purchaseEndTime: 1792108800000,
  canPurchase: true,
  apr: 2.5608,
  minAmount: 0.0001,
  maxAmount: 49,
  optionType: "CALL",
  ...p,
});

describe("нормализация каталогов Earn", () => {
  it("CALL — Sell High: вкладывается монета, страйк выше цены", () => {
    const [offer] = normalizeDualProducts([product({})], prices);
    expect(offer).toMatchObject({
      id: "dual:1",
      side: "sell-high",
      coin: "BTC",
      stable: "USDT",
      price: 80_884,
      durationDays: 1,
      settleAt: "2026-10-16T08:00:00.000Z",
    });
    expect(offer.strikePrice).toBeGreaterThan(offer.price ?? 0);
  });

  it("PUT — Buy Low: вкладывается стейбл, цена берётся по паре со стейблом", () => {
    const [offer] = normalizeDualProducts(
      [
        product({
          id: "2",
          optionType: "PUT",
          investCoin: "USDC",
          exercisedCoin: "BTC",
          strikePrice: 80_750,
        }),
      ],
      prices,
    );
    expect(offer).toMatchObject({
      side: "buy-low",
      coin: "BTC",
      stable: "USDC",
      price: 80_900,
    });
  });

  it("On-chain: награда другим токеном, распроданный или закрытый продукт", () => {
    const [own, other] = normalizeOnchainProducts(
      [
        {
          projectId: "Plasma-USDT-90D",
          detail: {
            asset: "USDT",
            rewardAsset: "USDT",
            duration: 90,
            apr: 0.0265,
            status: "PURCHASING",
          },
          quota: { totalPersonalQuota: 10_000_000, minimum: 100 },
        },
        {
          projectId: "BabyBTC-7d",
          detail: {
            asset: "BTC",
            rewardAsset: "BABY",
            duration: 7,
            apr: 0.0023,
            status: "SOLD_OUT",
          },
        },
      ],
      prices,
    );
    expect(own).toMatchObject({
      rewardAsset: null,
      lockDays: 90,
      minPurchase: 100,
      soldOut: false,
      priceUsd: 1,
    });
    expect(other).toMatchObject({
      rewardAsset: "BABY",
      soldOut: true,
      quotaLeft: null,
      priceUsd: 80_884,
    });
  });

  it("стейкинг и RWUSD/BFUSD: ставка из rateHistory, срок вывода из quota", () => {
    expect(
      stakingProduct(
        "eth-staking",
        { redeemPeriod: 27, stakeable: true, minStakeAmount: 0.0001 },
        { annualPercentageRate: 0.0224, time: 0 },
        prices,
      ),
    ).toMatchObject({
      asset: "ETH",
      rewardAsset: "WBETH",
      apr: 0.0224,
      redemptionDays: 27,
      soldOut: false,
      priceUsd: 3_000,
    });
    expect(
      stableYieldProduct(
        "bfusd",
        {
          subscribeEnable: false,
          standardRedemptionQuota: { redeemPeriod: 2 },
        },
        null,
      ),
    ).toMatchObject({
      name: "BFUSD",
      apr: null,
      redemptionDays: 2,
      soldOut: true,
    });
  });

  it("сводка: виды по productType, SIMPLE_EARN делится по duration, неизвестный тип пропускается", () => {
    const items = normalizeSummary([
      {
        asset: "USDT",
        productSummary: [
          {
            productType: "SIMPLE_EARN",
            maxApr: 0.065,
            minApr: 0.02,
            duration: ["FLEXIBLE", "FIXED"],
            lowRisk: true,
            soldOut: false,
          },
          {
            productType: "DUAL_CURRENCY",
            maxApr: 2.8,
            minApr: 0.03,
            duration: ["FIXED"],
            lowRisk: false,
            soldOut: false,
          },
          {
            productType: "SOMETHING_NEW",
            maxApr: 0.5,
            minApr: 0.1,
            duration: null,
            lowRisk: null,
            soldOut: null,
          },
          {
            productType: "BFUSD",
            maxApr: 0.013,
            minApr: null,
            duration: null,
            lowRisk: true,
            soldOut: null,
          },
        ],
      },
      { asset: "ETH", productSummary: null },
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      "simple-flexible",
      "simple-locked",
      "dual",
      "bfusd",
    ]);
    expect(items[3]).toMatchObject({
      minApr: 0.013,
      lowRisk: true,
      soldOut: false,
    });
  });
});
