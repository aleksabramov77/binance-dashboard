// Клиент-безопасный публичный API: только типы и чистые функции.
// Сетевые запросы — в `public.server.ts`, `account.server.ts`, `demo.server.ts` (только сервер).
export type {
  DualProduct,
  OnchainYieldsProduct,
  RatePoint,
  SoftStakingProduct,
  StableYieldQuota,
  StakingQuota,
} from "./earnAccountSchemas";
// Реальный счёт (spec 0047): права торгового ключа — схемы и чистая оценка (сеть — live.server.ts).
export {
  checkAccountUid,
  evaluateRestrictions,
  isKeyRejected,
  isUidBlocking,
  KEY_REJECTED_REASON,
  LIVE_FLAG_RULES,
  LIVE_KEY_FLAGS,
  type LiveFuturesAccount,
  type LiveKeyFlag,
  type LiveKeyFlags,
  type LiveSpotAccount,
  liveKeyFlagsSchema,
  MAIN_ACCOUNT_REASON,
  MAIN_UID_PENDING_REASON,
  type MainAccountUid,
  mainUidUnreadReason,
  mergeMainAccount,
  type RestrictionsVerdict,
  type UidCheckStatus,
} from "./liveRestrictions";
export type {
  BinanceMarket,
  Candle,
  FuturesMarket,
  Market,
  Perpetuals,
} from "./market";
export type { Ticker24h } from "./marketSchemas";
export { TRADE_MARKETS, tradeMarketSchema } from "./markets";
export { resolveUsdPrice } from "./prices";
export { type DemoProtectRefs, demoProtectRefsSchema } from "./protectRefs";
export type {
  EarnOverviewAsset,
  EarnOverviewProduct,
  EarnProduct,
  EarnProductDetail,
} from "./schemas";
export {
  sumUsd,
  type UsdPrice,
  WALLET_MARKET,
  type WalletEquity,
  type WalletEquityResult,
  walletsByMarket,
} from "./walletEquity";
