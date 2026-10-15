import {
  EARN_SUMMARY_TTL_MS,
  type EarnSummary,
  normalizeSummary,
} from "@/entities/earn-product";
import { fetchEarnOverview } from "@/shared/api/binance/public.server";
import { createTtlCache } from "./ttlCache";

const cache = createTtlCache<EarnSummary>(EARN_SUMMARY_TTL_MS);

/** Публичная сводка ставок по видам Earn (без ключа). Ошибка Binance пробрасывается — роут ответит 502. */
export function loadEarnSummary(): Promise<EarnSummary> {
  return cache.get(async () => ({
    fetchedAt: new Date().toISOString(),
    items: normalizeSummary(await fetchEarnOverview()),
  }));
}
