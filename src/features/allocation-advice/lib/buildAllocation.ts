import {
  BUCKETS,
  type BucketId,
  PROFILE_TARGETS,
  type RiskProfile,
} from "../config/profiles";

export interface Bucket {
  id: BucketId;
  /** Доля суммы, 0.25 = 25 %. */
  share: number;
  amountUsd: number;
}

/** Доли профиля → корзины с суммами в $ (в порядке BUCKETS, без нулевых). */
export function buildAllocation(
  amountUsd: number,
  profile: RiskProfile,
): Bucket[] {
  const targets = PROFILE_TARGETS[profile];
  const amount = Math.max(0, amountUsd);
  return BUCKETS.flatMap((id) => {
    const share = targets[id] ?? 0;
    return share > 0 ? [{ id, share, amountUsd: amount * share }] : [];
  });
}
