import { evaluateOffer, type Offer } from "@/entities/earn-offer";
import type { Holding, HoldingPlace } from "@/entities/holding";
import { isStablecoin } from "@/shared/config";
import { type Allocation, allocate } from "./allocate";

/** Ниже этих порогов совет не показываем — это шум. */
const MIN_MOVE_USD = 1;
const MIN_GAIN_USD = 1;
const LOCKED_MIN_EDGE = 0.005;

export interface Move {
  fromAsset: string;
  fromPlace: HoldingPlace;
  to: Offer;
  amountUsd: number;
  /** Сколько единиц исходного актива перекладывать. */
  fromAmount: number;
  /** Нужно обменять один стейблкоин на другой. */
  needsSwap: boolean;
}

export interface LockedAlternative {
  offer: Offer;
  amountUsd: number;
  apr: number;
  /** Сколько в год это даст сверх Flexible-плана. */
  extraIncomeUsd: number;
}

export interface GroupPlan {
  key: string;
  label: string;
  movableUsd: number;
  currentIncomeUsd: number;
  targetIncomeUsd: number;
  allocations: Allocation[];
  moves: Move[];
  locked: LockedAlternative | null;
}

const groupKey = (asset: string) => (isStablecoin(asset) ? "USD" : asset);

interface Source {
  holding: Holding;
  remainingUsd: number;
}

function buildMoves(sources: Source[], allocations: Allocation[]): Move[] {
  const targets = allocations.map((a) => ({
    offer: a.offer,
    remainingUsd: a.amountUsd,
  }));
  const moves: Move[] = [];
  const transfer = (
    s: Source,
    t: (typeof targets)[number],
    amountUsd: number,
  ) => {
    s.remainingUsd -= amountUsd;
    t.remainingUsd -= amountUsd;
    const sameProduct =
      s.holding.place === "flexible" &&
      t.offer.id.startsWith(`${s.holding.productId}:flexible`);
    if (sameProduct || amountUsd < MIN_MOVE_USD) return;
    moves.push({
      fromAsset: s.holding.asset,
      fromPlace: s.holding.place,
      to: t.offer,
      amountUsd,
      fromAmount: amountUsd / (s.holding.priceUsd ?? 1),
      needsSwap: s.holding.asset !== t.offer.asset,
    });
  };
  const match = (fits: (s: Source, t: (typeof targets)[number]) => boolean) => {
    for (const t of targets) {
      for (const s of sources) {
        if (t.remainingUsd <= 1e-9) break;
        if (s.remainingUsd <= 1e-9 || !fits(s, t)) continue;
        transfer(s, t, Math.min(s.remainingUsd, t.remainingUsd));
      }
    }
  };
  // 1) то, что уже лежит в нужном продукте, остаётся на месте;
  match(
    (s, t) =>
      s.holding.place === "flexible" &&
      t.offer.id.startsWith(`${s.holding.productId}:flexible`),
  );
  // 2) та же монета — просто перевод/подписка; сначала свободные деньги, потом Flexible;
  match(
    (s, t) =>
      s.holding.place !== "flexible" && s.holding.asset === t.offer.asset,
  );
  match((s, t) => s.holding.asset === t.offer.asset);
  // 3) остальное — через обмен стейблкоинов.
  match(() => true);
  return moves;
}

function bestLocked(
  group: Offer[],
  movableUsd: number,
  flexibleIncome: number,
  offers: Offer[],
): LockedAlternative | null {
  let best: LockedAlternative | null = null;
  for (const offer of group) {
    if (!offer.priceUsd) continue;
    const amountUsd = Math.min(
      movableUsd,
      (offer.maxPerUser ?? Number.POSITIVE_INFINITY) * offer.priceUsd,
    );
    const lockedYield = evaluateOffer(offer, amountUsd);
    if (!lockedYield || lockedYield.belowMinimum) continue;
    const rest = allocate(movableUsd - amountUsd, offers).incomeUsd;
    const extraIncomeUsd = lockedYield.yearlyIncomeUsd + rest - flexibleIncome;
    if (extraIncomeUsd > (best?.extraIncomeUsd ?? 0)) {
      best = {
        offer,
        amountUsd,
        apr: lockedYield.effectiveApr,
        extraIncomeUsd,
      };
    }
  }
  return best;
}

export function buildPlan(holdings: Holding[], offers: Offer[]): GroupPlan[] {
  const available = offers.filter((o) => !o.soldOut && o.priceUsd);
  const keys = [
    ...new Set(
      holdings
        .filter((h) => h.place !== "locked")
        .map((h) => groupKey(h.asset)),
    ),
  ];

  return keys
    .map((key): GroupPlan | null => {
      const sources: Source[] = holdings
        .filter(
          (h) =>
            h.place !== "locked" && groupKey(h.asset) === key && h.priceUsd,
        )
        .map((holding) => ({
          holding,
          remainingUsd: holding.amount * (holding.priceUsd ?? 0),
        }))
        .sort((a, b) => b.remainingUsd - a.remainingUsd);
      const movableUsd = sources.reduce((s, x) => s + x.remainingUsd, 0);
      if (movableUsd < MIN_MOVE_USD) return null;

      const groupOffers = available.filter((o) => groupKey(o.asset) === key);
      const flexibleOffers = groupOffers.filter((o) => o.type === "flexible");
      const target = allocate(movableUsd, flexibleOffers);
      const currentIncomeUsd = sources.reduce(
        (s, x) => s + x.remainingUsd * x.holding.apr,
        0,
      );
      const improves = target.incomeUsd - currentIncomeUsd >= MIN_GAIN_USD;
      const locked = bestLocked(
        groupOffers.filter((o) => o.type === "locked"),
        movableUsd,
        target.incomeUsd,
        flexibleOffers,
      );

      return {
        key,
        label: key === "USD" ? "Стейблкоины" : key,
        movableUsd,
        currentIncomeUsd,
        targetIncomeUsd: target.incomeUsd,
        allocations: target.allocations,
        moves: improves ? buildMoves(sources, target.allocations) : [],
        locked:
          locked && locked.apr - target.marginalApr >= LOCKED_MIN_EDGE
            ? locked
            : null,
      };
    })
    .filter((g): g is GroupPlan => g !== null)
    .sort(
      (a, b) =>
        b.targetIncomeUsd -
        b.currentIncomeUsd -
        (a.targetIncomeUsd - a.currentIncomeUsd),
    );
}
