export { getEarnOverview } from "./api/getEarnOverview";
export { earnOverviewQueryKey, useEarnOverview } from "./api/useEarnOverview";
export { evaluateOffer, type OfferYield, yearlyIncome } from "./lib/yield";
// Таблица снимков (Drizzle) — запросы делает сервер через shared/db.
export { earnSnapshotsTable } from "./model/db";
export { APR_CHANGE_THRESHOLD, diffSnapshots } from "./model/diff";
export { normalizeProducts } from "./model/normalize";
export {
  type EarnOverview,
  earnOverviewSchema,
  type Offer,
  type OfferChange,
  type OfferTier,
  type Snapshot,
  snapshotSchema,
} from "./model/schema";
export { OfferName, offerTermLabel } from "./ui/OfferName";
export { TierSummary } from "./ui/TierSummary";
