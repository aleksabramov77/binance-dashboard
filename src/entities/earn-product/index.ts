export {
  advancedCatalogQueryKey,
  useAdvancedCatalog,
} from "./api/useAdvancedCatalog";
export { earnSummaryQueryKey, useEarnSummary } from "./api/useEarnSummary";
export {
  EARN_KIND_INFO,
  type EarnKindInfo,
  type KindData,
  type KindTab,
  RISK_LABELS,
  type RiskLevel,
} from "./config/kinds";
export {
  type DualEvaluation,
  type DualOutcome,
  type DualScenarios,
  distanceToStrike,
  dualInvestAsset,
  dualReturn,
  dualScenarios,
  evaluateDual,
} from "./lib/dual";
export {
  normalizeDualProducts,
  normalizeOnchainProducts,
  normalizeSoftStaking,
  normalizeSummary,
  stableYieldProduct,
  stakingProduct,
} from "./model/normalize";
export {
  type AdvancedCatalog,
  advancedCatalogSchema,
  DUAL_SIDES,
  type DualOffer,
  type DualSide,
  EARN_KINDS,
  type EarnKind,
  type EarnSummary,
  earnSummarySchema,
  type KindSummary,
  YIELD_KINDS,
  type YieldKind,
  type YieldProduct,
} from "./model/schema";
export { DUAL_SIDE_LABELS, DualOfferName } from "./ui/DualOfferName";
export { KindBadge, PrincipalBadge } from "./ui/KindBadge";
export { RiskDots } from "./ui/RiskDots";
