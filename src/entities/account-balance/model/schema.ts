import { z } from "zod";

// Контракт GET /api/accounts/balances (spec 0038): остатки Demo- и Real-счетов Binance в $ по группам активов
// (кошелькам Spot, USDⓈ-M, COIN-M). Paper — бюджеты лаборатории, у них свой контракт. Real — торговый субсчёт
// по последнему пульсу воркера реального счёта (spec 0047).

/** Остаток кошелька: usd null — «—», причина в hint; hint при числе — оговорка (например, активы без цены). */
export const walletBalanceSchema = z.object({
  usd: z.number().nullable(),
  hint: z.string().nullable(),
  /** Остаток не с биржи сейчас, а из пульса воркера: время пульса (подсказка «пульс <время>»). */
  at: z.string().nullable().optional(),
});

export const accountWalletsSchema = z.object({
  spot: walletBalanceSchema,
  usdm: walletBalanceSchema,
  coinm: walletBalanceSchema,
});

export const accountBalancesSchema = z.object({
  demo: accountWalletsSchema,
  real: accountWalletsSchema,
  /** Когда остатки прочитаны с биржи (ответ кэшируется на сервере). */
  at: z.string(),
});

export type WalletBalance = z.infer<typeof walletBalanceSchema>;
export type AccountWallets = z.infer<typeof accountWalletsSchema>;
export type AccountBalances = z.infer<typeof accountBalancesSchema>;
