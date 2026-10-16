import { z } from "zod";

const decimal = z.coerce.number();

export const spotAccountSchema = z.object({
  balances: z.array(
    z.object({ asset: z.string(), free: decimal, locked: decimal }),
  ),
});

/** UID аккаунта из `/api/v3/account` (остальные поля не нужны). */
export const accountUidSchema = z.object({ uid: z.number() }).loose();

export const fundingAssetsSchema = z.array(
  z.object({
    asset: z.string(),
    free: decimal,
    locked: decimal,
    freeze: decimal,
  }),
);

export const flexiblePositionsSchema = z.object({
  total: z.number(),
  rows: z.array(
    z.object({
      asset: z.string(),
      productId: z.string(),
      totalAmount: decimal,
      latestAnnualPercentageRate: decimal,
      tierAnnualPercentageRate: z.record(z.string(), decimal).nullish(),
      canRedeem: z.boolean().optional(),
    }),
  ),
});

export const lockedPositionsSchema = z.object({
  total: z.number(),
  rows: z.array(
    z.object({
      positionId: z.coerce.string(),
      projectId: z.string(),
      asset: z.string(),
      amount: decimal,
      duration: decimal,
      APY: decimal,
      extraRewardAPR: decimal.optional(),
      boostApr: decimal.optional(),
      deliverDate: z.coerce.number().optional(),
      status: z.string().optional(),
    }),
  ),
});

/**
 * История начислений Flexible (`/sapi/v1/simple-earn/flexible/history/rewardsRecord`). Проба 2026-10-15: id продукта
 * приходит в `productId` (в документации — `projectId`), `rewards` — сумма в монете `asset`.
 */
export const flexibleRewardsSchema = z.object({
  total: z.number(),
  rows: z.array(
    z
      .object({
        asset: z.string(),
        rewards: decimal,
        productId: z.string().optional(),
        projectId: z.string().optional(),
        type: z.string(),
        time: z.number(),
      })
      .transform(({ projectId, ...row }) => ({
        ...row,
        productId: row.productId ?? projectId ?? null,
      })),
  ),
});

/** История начислений Locked (`/sapi/v1/simple-earn/locked/history/rewardsRecord`), поля — по документации. */
export const lockedRewardsSchema = z.object({
  total: z.number(),
  rows: z.array(
    z.object({
      positionId: z.coerce.string(),
      asset: z.string(),
      amount: decimal,
      time: z.number(),
      type: z.string().optional(),
    }),
  ),
});

export const walletBalancesSchema = z.array(
  z.object({ walletName: z.string(), balance: decimal, activate: z.boolean() }),
);

export const binanceErrorSchema = z.object({
  code: z.number(),
  msg: z.string(),
});

export type SpotAccount = z.infer<typeof spotAccountSchema>;
export type FundingAsset = z.infer<typeof fundingAssetsSchema>[number];
export type FlexiblePosition = z.infer<
  typeof flexiblePositionsSchema
>["rows"][number];
export type LockedPosition = z.infer<
  typeof lockedPositionsSchema
>["rows"][number];
export type FlexibleReward = z.infer<
  typeof flexibleRewardsSchema
>["rows"][number];
export type LockedReward = z.infer<typeof lockedRewardsSchema>["rows"][number];
export type WalletBalance = z.infer<typeof walletBalancesSchema>[number];
