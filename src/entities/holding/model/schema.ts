import { z } from "zod";

export const PLACES = ["spot", "funding", "flexible", "locked"] as const;

export const holdingSchema = z.object({
  asset: z.string(),
  place: z.enum(PLACES),
  /** Свободная сумма в единицах актива (её можно перекладывать). */
  amount: z.number(),
  /** Заморожено: в ордерах, в Locked-продукте и т.п. — не перекладывается. */
  frozen: z.number(),
  priceUsd: z.number().nullable(),
  /** Текущая ставка по данным аккаунта (для Spot/Funding — 0). */
  apr: z.number(),
  productId: z.string().nullable(),
  /** Locked: id позиции — по нему сопоставляются начисления из истории Binance. */
  positionId: z.string().nullable(),
  durationDays: z.number().nullable(),
  /** Locked: дата, когда деньги вернутся. */
  until: z.string().nullable(),
  /**
   * Начислено Binance за вчерашние сутки UTC, в долларах по текущей цене монеты награды (spec 0022).
   * null — не Earn (Spot/Funding) или история начислений не загрузилась.
   */
  yesterdayUsd: z.number().nullable(),
});

export const walletSchema = z.object({
  name: z.string(),
  balanceUsd: z.number(),
});

export const portfolioSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("not-configured"),
    /** cloud — облачный хостинг: ключ аккаунта туда не кладём, портфель только локально. */
    hosting: z.enum(["local", "cloud"]).default("local"),
  }),
  z.object({ status: z.literal("error"), message: z.string() }),
  z.object({
    status: z.literal("ok"),
    fetchedAt: z.string(),
    holdings: z.array(holdingSchema),
    wallets: z.array(walletSchema),
  }),
]);

export type HoldingPlace = (typeof PLACES)[number];
export type Holding = z.infer<typeof holdingSchema>;
export type Wallet = z.infer<typeof walletSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;

export function holdingValueUsd(h: Holding): number | null {
  return h.priceUsd === null ? null : (h.amount + h.frozen) * h.priceUsd;
}

export const INCOME_PERIODS = ["day", "month", "year"] as const;
export type IncomePeriod = (typeof INCOME_PERIODS)[number];
const PERIODS_PER_YEAR: Record<IncomePeriod, number> = {
  day: 365,
  month: 12,
  year: 1,
};

/** Плановый доход за период по текущей ставке: год = USD × ставка, день — /365, месяц — /12. */
export function plannedIncomeUsd(
  h: Holding,
  period: IncomePeriod,
): number | null {
  const value = holdingValueUsd(h);
  return value === null ? null : (value * h.apr) / PERIODS_PER_YEAR[period];
}
