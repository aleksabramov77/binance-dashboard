import { describe, expect, it } from "vitest";
import {
  dualProductsSchema,
  onchainYieldsListSchema,
  rateHistorySchema,
  stableYieldQuotaSchema,
  stakingQuotaSchema,
} from "./earnAccountSchemas";
import { earnOverviewResponseSchema } from "./schemas";

// Фикстуры повторяют форму ответов из пробы 2026-10-15 (значения условные).
describe("схемы подписанных ручек Earn", () => {
  it("dci/product/list: строки → числа, время в мс, APR — доля", () => {
    const parsed = dualProductsSchema.parse({
      total: 667,
      list: [
        {
          id: "2609762",
          investCoin: "BTC",
          exercisedCoin: "USDT",
          strikePrice: "81000",
          duration: 1,
          settleDate: 1792137600000,
          purchaseDecimal: 8,
          purchaseEndTime: 1792108800000,
          canPurchase: true,
          apr: "2.5608",
          orderId: 52292317249,
          minAmount: "0.0001",
          maxAmount: "49",
          createTimestamp: 1784634634000,
          optionType: "CALL",
          isAutoCompoundEnable: false,
          autoCompoundPlanList: [],
        },
      ],
    });
    expect(parsed.list[0]).toMatchObject({
      strikePrice: 81000,
      apr: 2.5608,
      minAmount: 0.0001,
      optionType: "CALL",
    });
  });

  it("onchain-yields/locked/list: продукт с наградой и квотой", () => {
    const parsed = onchainYieldsListSchema.parse({
      total: 1,
      rows: [
        {
          projectId: "Plasma-USDT-90D",
          detail: {
            asset: "USDT",
            rewardAsset: "USDT",
            duration: 90,
            renewable: true,
            isSoldOut: false,
            apr: "0.0265",
            status: "PURCHASING",
            subscriptionStartTime: 1758790800000,
            canRedeemToFlex: true,
          },
          quota: { totalPersonalQuota: "10000000", minimum: "100" },
        },
      ],
    });
    expect(parsed.rows[0].detail.apr).toBe(0.0265);
    expect(parsed.rows[0].quota?.minimum).toBe(100);
  });

  it("квоты стейкинга и RWUSD/BFUSD терпят отсутствие второстепенных полей", () => {
    expect(
      stakingQuotaSchema.parse({
        leftStakingPersonalQuota: "500000",
        minStakeAmount: "0.0001",
        redeemPeriod: 27,
        stakeable: true,
      }),
    ).toMatchObject({ redeemPeriod: 27, leftStakingPersonalQuota: 500000 });
    expect(
      stableYieldQuotaSchema.parse({
        subscriptionQuota: { leftQuota: "19985113" },
        standardRedemptionQuota: { redeemPeriod: 2, fee: "0.00025" },
      }).standardRedemptionQuota,
    ).toEqual({ redeemPeriod: 2, fee: 0.00025 });
  });

  it("rateHistory: годовая ставка строкой → доля", () => {
    expect(
      rateHistorySchema.parse({
        total: 1,
        rows: [{ annualPercentageRate: "0.0361", time: 1791936000000 }],
      }).rows[0].annualPercentageRate,
    ).toBe(0.0361);
  });

  it("homepage/overview: пустые поля сводки не ломают разбор", () => {
    const parsed = earnOverviewResponseSchema.parse({
      code: "000000",
      data: {
        total: "12",
        list: [
          {
            asset: "USDT",
            productSummary: [
              {
                productType: "BFUSD",
                maxApr: "0.0134",
                minApr: null,
                duration: ["FLEXIBLE"],
                lowRisk: true,
                soldOut: null,
              },
            ],
          },
        ],
      },
    });
    expect(parsed.data.list[0].productSummary?.[0]).toMatchObject({
      maxApr: 0.0134,
      minApr: null,
      lowRisk: true,
    });
  });
});
