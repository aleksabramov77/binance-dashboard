import { z } from "zod";

// Ответы подписанных ручек Earn (read-only ключ). Поля сверены пробой 2026-10-15 (spec 0019):
// числа приходят строками, время — в мс, APR — доли (2.56 = 256 % годовых), duration — дни.
const decimal = z.coerce.number();
const optionalDecimal = decimal.optional().catch(undefined);

/** Dual Investment: `GET /sapi/v1/dci/product/list` (CALL — вкладывается монета, PUT — стейбл). */
export const dualProductsSchema = z.object({
  total: z.coerce.number(),
  list: z.array(
    z.object({
      id: z.coerce.string(),
      investCoin: z.string(),
      exercisedCoin: z.string(),
      strikePrice: decimal,
      duration: decimal,
      settleDate: z.coerce.number(),
      purchaseEndTime: z.coerce.number(),
      canPurchase: z.boolean(),
      apr: decimal,
      minAmount: decimal,
      maxAmount: decimal,
      optionType: z.enum(["CALL", "PUT"]),
    }),
  ),
});

/** On-chain Yields: `GET /sapi/v1/onchain-yields/locked/list`. */
export const onchainYieldsListSchema = z.object({
  total: z.coerce.number(),
  rows: z.array(
    z.object({
      projectId: z.string(),
      detail: z.object({
        asset: z.string(),
        rewardAsset: z.string().optional(),
        duration: decimal,
        isSoldOut: z.boolean().optional().catch(undefined),
        apr: decimal,
        status: z.string().optional(),
        canRedeemToFlex: z.boolean().optional().catch(undefined),
      }),
      quota: z
        .object({
          totalPersonalQuota: optionalDecimal,
          minimum: optionalDecimal,
        })
        .optional(),
    }),
  ),
});

/** ETH и SOL staking: `GET /sapi/v1/eth-staking/eth/quota`, `/sapi/v1/sol-staking/sol/quota`. */
export const stakingQuotaSchema = z.object({
  leftStakingPersonalQuota: optionalDecimal,
  minStakeAmount: optionalDecimal,
  /** Дней до возврата ETH/SOL при выходе из стейкинга. */
  redeemPeriod: optionalDecimal,
  stakeable: z.boolean().optional().catch(undefined),
  soldOut: z.boolean().optional().catch(undefined),
  commissionFee: optionalDecimal,
});

/** RWUSD и BFUSD: `GET /sapi/v1/rwusd/quota`, `/sapi/v1/bfusd/quota`. */
export const stableYieldQuotaSchema = z.object({
  subscribeEnable: z.boolean().optional().catch(undefined),
  subscriptionQuota: z
    .object({ leftQuota: optionalDecimal, minimum: optionalDecimal })
    .optional(),
  standardRedemptionQuota: z
    .object({ redeemPeriod: optionalDecimal, fee: optionalDecimal })
    .optional(),
  fastRedemptionQuota: z
    .object({ fee: optionalDecimal, freeQuota: optionalDecimal })
    .optional(),
});

/** История ставки: `…/history/rateHistory` у ETH/SOL staking, RWUSD, BFUSD (берём последнюю строку). */
export const rateHistorySchema = z.object({
  rows: z.array(
    z.object({ annualPercentageRate: decimal, time: z.coerce.number() }),
  ),
});

/** Soft Staking: `GET /sapi/v1/soft-staking/list`. */
export const softStakingListSchema = z.object({
  total: z.coerce.number(),
  rows: z.array(
    z.object({
      asset: z.string(),
      apr: decimal,
      minAmount: optionalDecimal,
      maxCap: optionalDecimal,
    }),
  ),
});

export type DualProduct = z.infer<typeof dualProductsSchema>["list"][number];
export type OnchainYieldsProduct = z.infer<
  typeof onchainYieldsListSchema
>["rows"][number];
export type StakingQuota = z.infer<typeof stakingQuotaSchema>;
export type StableYieldQuota = z.infer<typeof stableYieldQuotaSchema>;
export type RatePoint = z.infer<typeof rateHistorySchema>["rows"][number];
export type SoftStakingProduct = z.infer<
  typeof softStakingListSchema
>["rows"][number];
