import type { HoldingPlace } from "@/entities/holding";
import type {
  FlexibleReward,
  LockedReward,
  RewardsWindow,
} from "@/shared/api/binance/account.server";
import { log } from "@/shared/lib/logger.server";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Виды начислений Flexible, которые складываем (проба 2026-10-15, spec 0022): `REALTIME` — базовая ставка за сутки,
 * `BONUS` — бонусная ступень; `type=ALL` отдаёт ровно их объединение без повторов.
 */
export const FLEXIBLE_REWARD_TYPES: ReadonlySet<string> = new Set([
  "REALTIME",
  "BONUS",
]);
/**
 * Известные, но не суммируемые виды: `REWARDS` (старая история) за 30 дней пуст и не учитывается, чтобы не задвоить
 * суммы, если Binance начнёт его заполнять. Остальные виды — неизвестные: в сумму не идут, но пишутся в журнал.
 */
const SKIPPED_FLEXIBLE_REWARD_TYPES: ReadonlySet<string> = new Set(["REWARDS"]);
/** Неизвестные виды начислений, о которых уже написали в журнал (раз на вид за процесс). */
const reportedUnknownTypes = new Set<string>();

/**
 * Сколько с начала UTC-суток ответ истории за вчера ещё «дозревает»: `REALTIME` за вчера пишется задним числом
 * (`time` 23:59:59), а `BONUS` на пробе пришёл в 04:43 UTC. Пока не прошло 6 ч — кэшируем коротко, чтобы не закрепить
 * неполный ответ до следующей полуночи.
 */
export const REWARDS_SETTLE_MS = 6 * 60 * 60 * 1000;
/** Срок кэша истории, пока ответ дозревает. */
export const REWARDS_UNSETTLED_TTL_MS = 15 * 60 * 1000;

/** Вчерашние сутки UTC: [полночь UTC сегодня − 1 сутки, полночь UTC сегодня). Binance начисляет по суткам UTC. */
export function yesterdayUtcRange(now: Date): RewardsWindow {
  const endTime = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return { startTime: endTime - DAY_MS, endTime };
}

/**
 * Срок кэша наград за вчера: первые `REWARDS_SETTLE_MS` UTC-суток — `REWARDS_UNSETTLED_TTL_MS`, потом — до
 * следующей полуночи UTC (за прошедшие сутки начисления уже не меняются).
 */
export function rewardsCacheTtlMs(now: Date): number {
  const { endTime: todayStart } = yesterdayUtcRange(now);
  const sinceMidnight = now.getTime() - todayStart;
  return sinceMidnight < REWARDS_SETTLE_MS
    ? REWARDS_UNSETTLED_TTL_MS
    : todayStart + DAY_MS - now.getTime();
}

export type YesterdayRewards = {
  flexible: FlexibleReward[];
  locked: LockedReward[];
};

/** Начисления в USD: Flexible — по продукту (без id — по монете), Locked — по позиции. null — цена награды неизвестна. */
export type YesterdayRewardsUsd = {
  flexibleByProduct: Map<string, number | null>;
  flexibleByAsset: Map<string, number | null>;
  lockedByPosition: Map<string, number | null>;
};

function add(
  sums: Map<string, number | null>,
  key: string,
  usd: number | null,
): void {
  const prev = sums.get(key);
  sums.set(
    key,
    prev === undefined
      ? usd
      : prev === null || usd === null
        ? null
        : prev + usd,
  );
}

/** Суммирует начисления в USD; каждая награда — по цене своей монеты. */
export function sumYesterdayRewardsUsd(
  rewards: YesterdayRewards,
  price: (asset: string) => number | null,
): YesterdayRewardsUsd {
  const usd = (asset: string, amount: number) => {
    const p = price(asset);
    return p === null ? null : amount * p;
  };
  const sums: YesterdayRewardsUsd = {
    flexibleByProduct: new Map(),
    flexibleByAsset: new Map(),
    lockedByPosition: new Map(),
  };
  for (const r of rewards.flexible) {
    if (!FLEXIBLE_REWARD_TYPES.has(r.type)) {
      if (
        !SKIPPED_FLEXIBLE_REWARD_TYPES.has(r.type) &&
        !reportedUnknownTypes.has(r.type)
      ) {
        reportedUnknownTypes.add(r.type);
        log.warn(
          "portfolio.rewards.type",
          `Неизвестный вид начислений Flexible «${r.type}» — в «Вчера» не учтён`,
          { type: r.type, asset: r.asset, productId: r.productId },
        );
      }
      continue;
    }
    const value = usd(r.asset, r.rewards);
    if (r.productId) add(sums.flexibleByProduct, r.productId, value);
    else add(sums.flexibleByAsset, r.asset, value);
  }
  for (const r of rewards.locked)
    add(sums.lockedByPosition, r.positionId, usd(r.asset, r.amount));
  return sums;
}

type EarnPosition = {
  asset: string;
  place: HoldingPlace;
  productId: string | null;
  positionId: string | null;
};

/**
 * «Вчера» для строки портфеля: у Spot/Funding и при сбое истории (`sums` null) — null; у Earn-позиции без
 * начислений — 0.
 */
export function yesterdayUsdFor(
  h: EarnPosition,
  sums: YesterdayRewardsUsd | null,
): number | null {
  if (sums === null) return null;
  if (h.place === "locked")
    return h.positionId === null
      ? 0
      : (sums.lockedByPosition.get(h.positionId) ?? 0);
  if (h.place !== "flexible") return null;
  const parts = [
    h.productId === null ? undefined : sums.flexibleByProduct.get(h.productId),
    sums.flexibleByAsset.get(h.asset),
  ];
  let total = 0;
  for (const part of parts) {
    if (part === null) return null;
    if (part !== undefined) total += part;
  }
  return total;
}
