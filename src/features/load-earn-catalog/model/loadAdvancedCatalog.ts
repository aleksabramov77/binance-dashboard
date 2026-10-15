import {
  type AdvancedCatalog,
  type DualOffer,
  normalizeDualProducts,
  normalizeOnchainProducts,
  normalizeSoftStaking,
  stableYieldProduct,
  stakingProduct,
  type YieldProduct,
} from "@/entities/earn-product";
import {
  fetchDualProducts,
  fetchLatestRate,
  fetchOnchainYieldsProducts,
  fetchSoftStakingList,
  fetchStableYieldQuota,
  fetchStakingQuota,
} from "@/shared/api/binance/account.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import {
  type BinanceCredentials,
  getBinanceCredentials,
  isServerless,
} from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import {
  CATALOG_TTL_MS,
  DUAL_COINS,
  DUAL_STABLES,
} from "../config/dualUniverse";
import { createTtlCache } from "./ttlCache";

/** Сеть и env внедряются — тесты подменяют их без моков модулей. */
export interface CatalogDeps {
  credentials: () => BinanceCredentials | null;
  hosting: () => "local" | "cloud";
  prices: typeof fetchTickerPrices;
  dual: typeof fetchDualProducts;
  onchain: typeof fetchOnchainYieldsProducts;
  softStaking: typeof fetchSoftStakingList;
  stakingQuota: typeof fetchStakingQuota;
  stableQuota: typeof fetchStableYieldQuota;
  latestRate: typeof fetchLatestRate;
}

const defaultDeps: CatalogDeps = {
  credentials: getBinanceCredentials,
  hosting: () => (isServerless() ? "cloud" : "local"),
  prices: fetchTickerPrices,
  dual: fetchDualProducts,
  onchain: fetchOnchainYieldsProducts,
  softStaking: fetchSoftStakingList,
  stakingQuota: fetchStakingQuota,
  stableQuota: fetchStableYieldQuota,
  latestRate: fetchLatestRate,
};

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

/** Все пары Dual: по каждой — свой запрос; упавшие пары перечисляются, остальные показываются. */
async function loadDual(
  creds: BinanceCredentials,
  deps: CatalogDeps,
  prices: Map<string, number>,
): Promise<{ offers: DualOffer[]; failed: string[]; firstError: unknown }> {
  const pairs = DUAL_COINS.flatMap((coin) =>
    DUAL_STABLES.flatMap((stable) => [
      {
        label: `${coin}/${stable} Sell High`,
        query: {
          optionType: "CALL" as const,
          investCoin: coin,
          exercisedCoin: stable,
        },
      },
      {
        label: `${coin}/${stable} Buy Low`,
        query: {
          optionType: "PUT" as const,
          investCoin: stable,
          exercisedCoin: coin,
        },
      },
    ]),
  );
  const results = await Promise.allSettled(
    pairs.map((p) => deps.dual(creds, p.query)),
  );
  const offers: DualOffer[] = [];
  const failed: string[] = [];
  let firstError: unknown = null;
  results.forEach((result, i) => {
    if (result.status === "fulfilled")
      offers.push(...normalizeDualProducts(result.value, prices));
    else {
      failed.push(pairs[i].label);
      firstError ??= result.reason;
    }
  });
  if (failed.length === pairs.length) throw firstError;
  return { offers, failed, firstError };
}

/** Загрузка каталогов без кэша: группы независимы, упавшие уходят в warnings. */
export async function buildAdvancedCatalog(
  deps: CatalogDeps = defaultDeps,
  now: () => Date = () => new Date(),
): Promise<AdvancedCatalog> {
  const creds = deps.credentials();
  // В облаке ключа реального аккаунта нет намеренно (как у Портфеля, docs/ai/deploy-supabase.md).
  if (!creds) return { status: "not-configured", hosting: deps.hosting() };

  const warnings: string[] = [];
  const prices = await deps.prices().catch((error: unknown) => {
    warnings.push(`Цены монет: ${message(error)}`);
    return new Map<string, number>();
  });

  const groups: { label: string; load: () => Promise<YieldProduct[]> }[] = [
    {
      label: "On-chain Yields",
      load: async () =>
        normalizeOnchainProducts(await deps.onchain(creds), prices),
    },
    ...(["eth", "sol"] as const).map((coin) => ({
      label: `${coin.toUpperCase()} Staking`,
      load: async () => {
        const [quota, rate] = await Promise.all([
          deps.stakingQuota(creds, coin),
          deps.latestRate(creds, coin),
        ]);
        return [stakingProduct(`${coin}-staking`, quota, rate, prices)];
      },
    })),
    ...(["rwusd", "bfusd"] as const).map((product) => ({
      label: product.toUpperCase(),
      load: async () => {
        const [quota, rate] = await Promise.all([
          deps.stableQuota(creds, product),
          deps.latestRate(creds, product),
        ]);
        return [stableYieldProduct(product, quota, rate)];
      },
    })),
    {
      label: "Soft Staking",
      load: async () =>
        normalizeSoftStaking(await deps.softStaking(creds), prices),
    },
  ];

  const [dual, ...yieldResults] = await Promise.allSettled([
    loadDual(creds, deps, prices),
    ...groups.map((g) => g.load()),
  ]);

  const failures: unknown[] = [];
  let dualOffers: DualOffer[] = [];
  if (dual.status === "fulfilled") {
    dualOffers = dual.value.offers;
    if (dual.value.failed.length > 0)
      warnings.push(
        `Dual Investment: не загрузились ${dual.value.failed.join(", ")} — ${message(dual.value.firstError)}`,
      );
  } else {
    failures.push(dual.reason);
    warnings.push(`Dual Investment: ${message(dual.reason)}`);
  }

  const yields: YieldProduct[] = [];
  yieldResults.forEach((result, i) => {
    if (result.status === "fulfilled") yields.push(...result.value);
    else {
      failures.push(result.reason);
      warnings.push(`${groups[i].label}: ${message(result.reason)}`);
    }
  });

  // Не загрузилось ничего (обычно — невалидный ключ): показываем ошибку Binance целиком.
  if (failures.length === groups.length + 1)
    return { status: "error", message: message(failures[0]) };
  if (warnings.length > 0)
    log.warn("earn.catalog", "часть каталогов Earn не загрузилась", {
      warnings,
    });
  return {
    status: "ok",
    fetchedAt: now().toISOString(),
    dual: dualOffers,
    yields,
    warnings,
  };
}

const cache = createTtlCache<AdvancedCatalog>(
  CATALOG_TTL_MS,
  (catalog) => catalog.status === "ok",
);

/** Каталоги сложных продуктов Earn по read-only ключу; успешный ответ кэшируется на 5 минут. */
export function loadAdvancedCatalog(): Promise<AdvancedCatalog> {
  return cache.get(async () => {
    try {
      return await buildAdvancedCatalog();
    } catch (error) {
      return { status: "error", message: message(error) };
    }
  });
}
