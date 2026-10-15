import { evaluateOffer, type Offer } from "@/entities/earn-offer";
import {
  type AdvancedCatalog,
  type DualOffer,
  distanceToStrike,
  EARN_KIND_INFO,
  type KindSummary,
  type YieldProduct,
} from "@/entities/earn-product";
import { isStablecoin } from "@/shared/config";
import {
  BUCKET_KINDS,
  type BucketId,
  type RiskProfile,
} from "../config/profiles";
import {
  DUAL_MAX_DAYS,
  DUAL_MAX_PICKS,
  DUAL_MIN_DISTANCE,
  LOCK_LADDER,
  MAX_SHARE_PER_DUAL_OFFER,
  MAX_SHARE_PER_PRODUCT,
  MAX_SHARE_PER_PROTOCOL,
  MAX_UNPROTECTED_SHARE,
} from "../config/rules";
import type { Bucket } from "./buildAllocation";

export interface AllocationPick {
  id: string;
  label: string;
  amountUsd: number;
  /** Годовая ставка на эту часть. */
  apr: number;
  note: string | null;
}

/** Почему корзина заполнена не целиком. */
export type BucketGap =
  | "needs-key"
  | "catalog-unavailable"
  | "no-snapshot"
  | "no-products"
  | "below-minimum"
  | "unprotected-limit"
  | "manual";

export interface FilledBucket extends Bucket {
  picks: AllocationPick[];
  /** Сумма, не разложенная по конкретным продуктам. */
  unplacedUsd: number;
  gap: BucketGap | null;
  /** Ожидаемый доход в год: по продуктам, а неразмещённая часть — по минимальной ставке сводки. */
  expectedIncomeUsd: number;
  /** Часть дохода посчитана по сводке, а не по продуктам. */
  estimated: boolean;
}

export interface AllocationPlan {
  amountUsd: number;
  buckets: FilledBucket[];
  expectedIncomeUsd: number;
  unfilledUsd: number;
}

export interface AllocationSources {
  /** Последний снимок Simple Earn; null — снимка нет. */
  simpleOffers: Offer[] | null;
  /** Каталог по ключу; null — ещё грузится или не запрашивался. */
  catalog: AdvancedCatalog | null;
  summary: KindSummary[] | null;
}

interface Candidate {
  id: string;
  label: string;
  apr: number;
  note?: string | null;
  /** Сколько $ можно положить в продукт (лимиты Binance и наши). */
  limitUsd: number;
  /** Минимальная покупка в $; меньшая доля продукту не достаётся. */
  minUsd: number;
  /** Капитал не защищён — доля идёт в лимит MAX_UNPROTECTED_SHARE профиля. */
  unprotected: boolean;
}

/** Общее состояние раскладки по всем корзинам плана. */
interface FillContext {
  /** Сколько $ ещё можно положить в продукты с незащищённым капиталом. */
  unprotectedLeftUsd: number;
  /** Причины недоразмещения текущей корзины. */
  hitUnprotected: boolean;
  hitMinimum: boolean;
}

const MIN_PICK_USD = 0.01;

/** Сколько дать кандидату из желаемого `wantUsd` с учётом остатка незащищённого бюджета. */
function grant(c: Candidate, wantUsd: number, ctx: FillContext): number {
  const want = Math.min(wantUsd, c.limitUsd);
  if (!c.unprotected || want <= ctx.unprotectedLeftUsd) return want;
  ctx.hitUnprotected = true;
  return Math.max(0, ctx.unprotectedLeftUsd);
}

function take(
  c: Candidate,
  amountUsd: number,
  ctx: FillContext,
): AllocationPick {
  if (c.unprotected) ctx.unprotectedLeftUsd -= amountUsd;
  return {
    id: c.id,
    label: c.label,
    amountUsd,
    apr: c.apr,
    note: c.note ?? null,
  };
}

/** Жадно раскладывает сумму по кандидатам (уже отсортированным), каждому — не больше его лимита. */
function distribute(
  amountUsd: number,
  candidates: Candidate[],
  ctx: FillContext,
) {
  const picks: AllocationPick[] = [];
  let left = amountUsd;
  for (const c of candidates) {
    if (left < MIN_PICK_USD) break;
    const amount = grant(c, left, ctx);
    if (amount < MIN_PICK_USD) continue;
    if (amount < c.minUsd) {
      ctx.hitMinimum = true;
      continue;
    }
    picks.push(take(c, amount, ctx));
    left -= amount;
  }
  return picks;
}

/**
 * Делит сумму поровну между кандидатами («водой»): сначала незащищённые и с меньшим лимитом, их
 * недобор переходит остальным. Кандидат, которому достаётся меньше его минимума, выбывает — и делёж
 * начинается заново без него.
 */
function splitEvenly(
  amountUsd: number,
  candidates: Candidate[],
  ctx: FillContext,
) {
  let pool = [...candidates].sort(
    (a, b) =>
      Number(b.unprotected) - Number(a.unprotected) || a.limitUsd - b.limitUsd,
  );
  for (;;) {
    const budget = ctx.unprotectedLeftUsd;
    const hitUnprotected = ctx.hitUnprotected;
    const plan: { c: Candidate; amount: number }[] = [];
    let left = amountUsd;
    pool.forEach((c, i) => {
      const amount = grant(c, left / (pool.length - i), ctx);
      if (c.unprotected) ctx.unprotectedLeftUsd -= amount;
      plan.push({ c, amount });
      left -= amount;
    });
    // Пробный делёж не должен тратить бюджет: настоящие траты — в take ниже.
    ctx.unprotectedLeftUsd = budget;
    const tooSmall = plan.find(
      (p) => p.amount >= MIN_PICK_USD && p.amount < p.c.minUsd,
    );
    if (!tooSmall) {
      return plan
        .filter((p) => p.amount >= MIN_PICK_USD)
        .map((p) => take(p.c, p.amount, ctx));
    }
    ctx.hitUnprotected = hitUnprotected;
    ctx.hitMinimum = true;
    pool = pool.filter((c) => c !== tooSmall.c);
  }
}

const offerMinUsd = (o: Offer) =>
  o.minPurchase !== null && o.priceUsd !== null
    ? o.minPurchase * o.priceUsd
    : 0;

function simpleFlexible(
  bucket: Bucket,
  offers: Offer[],
  capUsd: number,
  ctx: FillContext,
) {
  const candidates = offers
    .filter((o) => o.type === "flexible" && o.stablecoin && !o.soldOut)
    .map((o) => ({
      offer: o,
      y: evaluateOffer(o, Math.min(bucket.amountUsd, capUsd)),
    }))
    .sort((a, b) => (b.y?.effectiveApr ?? 0) - (a.y?.effectiveApr ?? 0))
    .map(
      ({ offer, y }): Candidate => ({
        id: offer.id,
        label: `${offer.asset} Flexible`,
        apr: y?.effectiveApr ?? offer.baseApr,
        limitUsd: capUsd,
        minUsd: offerMinUsd(offer),
        unprotected: false,
      }),
    );
  return distribute(bucket.amountUsd, candidates, ctx);
}

/**
 * Лестница Locked: сумма поровну на сроки LOCK_LADDER. На каждой ступени из ещё не выбранных
 * продуктов, доступных на эту сумму, берётся ближайший срок, а на нём — лучшая ставка.
 */
function simpleLocked(
  bucket: Bucket,
  offers: Offer[],
  capUsd: number,
  ctx: FillContext,
) {
  const locked = offers.filter(
    (o) => o.type === "locked" && o.stablecoin && !o.soldOut,
  );
  // Разные ступени — разные продукты, поэтому лимит на продукт проверяется по ступени.
  const rungUsd = Math.min(bucket.amountUsd / LOCK_LADDER.length, capUsd);
  const picks: AllocationPick[] = [];
  for (const rung of LOCK_LADDER) {
    const options = locked
      .filter((o) => !picks.some((p) => p.id === o.id))
      .map((o) => ({ offer: o, y: evaluateOffer(o, rungUsd) }))
      .filter((c) => c.y !== null);
    const affordable = options.filter((c) => !c.y?.belowMinimum);
    if (affordable.length < options.length) ctx.hitMinimum = true;
    if (affordable.length === 0) continue;
    const nearest = Math.min(
      ...affordable.map((c) => Math.abs(c.offer.durationDays - rung)),
    );
    const best = affordable
      .filter((c) => Math.abs(c.offer.durationDays - rung) === nearest)
      .sort((a, b) => (b.y?.effectiveApr ?? 0) - (a.y?.effectiveApr ?? 0))[0];
    picks.push({
      id: best.offer.id,
      label: `${best.offer.asset} Locked ${best.offer.durationDays} дн.`,
      amountUsd: rungUsd,
      apr: best.y?.effectiveApr ?? best.offer.baseApr,
      note: null,
    });
  }
  return picks;
}

const available = (products: YieldProduct[]) =>
  products.filter((p) => !p.soldOut && p.apr !== null && p.apr > 0);

const byApr = (a: YieldProduct, b: YieldProduct) => (b.apr ?? 0) - (a.apr ?? 0);

function yieldCandidate(p: YieldProduct, capUsd: number): Candidate {
  const quotaUsd =
    p.quotaLeft === null || p.priceUsd === null
      ? capUsd
      : p.quotaLeft * p.priceUsd;
  return {
    id: p.id,
    label: p.name,
    apr: p.apr ?? 0,
    limitUsd: Math.min(capUsd, quotaUsd),
    minUsd:
      p.minPurchase !== null && p.priceUsd !== null
        ? p.minPurchase * p.priceUsd
        : 0,
    unprotected: !EARN_KIND_INFO[p.kind].principalProtected,
  };
}

/** DeFi: стейблкоины первыми, не больше одного продукта и MAX_SHARE_PER_PROTOCOL на протокол. */
function onchain(
  bucket: Bucket,
  products: YieldProduct[],
  totalUsd: number,
  ctx: FillContext,
) {
  const protocolCap = totalUsd * MAX_SHARE_PER_PROTOCOL;
  const seen = new Set<string>();
  const candidates = available(products)
    .sort(
      (a, b) =>
        Number(isStablecoin(b.asset)) - Number(isStablecoin(a.asset)) ||
        byApr(a, b),
    )
    .filter((p) => {
      // projectId вида «Plasma-USDT-90D»: протокол — до первого дефиса.
      const protocol = p.name.split("-")[0];
      if (seen.has(protocol)) return false;
      seen.add(protocol);
      return true;
    })
    .map((p) => ({
      ...yieldCandidate(p, protocolCap),
      note: `вкладываете ${p.asset}`,
    }));
  return distribute(bucket.amountUsd, candidates, ctx);
}

/** Dual: только Buy Low на стейблах (у вас доллары), цель дальше DUAL_MIN_DISTANCE ниже цены, срок ≤ DUAL_MAX_DAYS, лучшее по монете. */
function dual(
  bucket: Bucket,
  offers: DualOffer[],
  totalUsd: number,
  ctx: FillContext,
) {
  const best = new Map<string, DualOffer>();
  for (const o of offers) {
    const distance = distanceToStrike(o.strikePrice, o.price);
    if (
      o.side !== "buy-low" ||
      !o.canPurchase ||
      o.durationDays > DUAL_MAX_DAYS ||
      distance === null ||
      distance > -DUAL_MIN_DISTANCE
    )
      continue;
    const current = best.get(o.coin);
    if (!current || o.apr > current.apr) best.set(o.coin, o);
  }
  const cap =
    totalUsd * Math.min(MAX_SHARE_PER_DUAL_OFFER, MAX_SHARE_PER_PRODUCT);
  const candidates = [...best.values()]
    .sort((a, b) => b.apr - a.apr)
    .slice(0, DUAL_MAX_PICKS)
    .map(
      (o): Candidate => ({
        id: o.id,
        label: `${o.coin} Buy Low ${o.durationDays} дн.`,
        apr: o.apr,
        note: `купите ${o.coin}, если цена упадёт до ${Math.round(o.strikePrice)} ${o.stable}`,
        limitUsd: Math.min(cap, o.maxAmount > 0 ? o.maxAmount : cap),
        // Buy Low вкладывает стейбл: минимум в стейбле = в $.
        minUsd: o.minAmount,
        unprotected: true,
      }),
    );
  return splitEvenly(bucket.amountUsd, candidates, ctx);
}

function catalogGap(catalog: AdvancedCatalog | null): BucketGap {
  return catalog?.status === "not-configured"
    ? "needs-key"
    : "catalog-unavailable";
}

/** Минимальная ставка сводки по видам корзины — осторожная оценка дохода неразмещённой части. */
function summaryApr(
  id: BucketId,
  summary: KindSummary[] | null,
): number | null {
  const rows = (summary ?? []).filter((s) => BUCKET_KINDS[id].includes(s.kind));
  if (rows.length === 0) return null;
  const stable = rows.filter((r) => isStablecoin(r.asset));
  return Math.min(...(stable.length > 0 ? stable : rows).map((r) => r.minApr));
}

function fillBucket(
  bucket: Bucket,
  sources: AllocationSources,
  totalUsd: number,
  ctx: FillContext,
): { picks: AllocationPick[]; gap: BucketGap | null } {
  const capUsd = totalUsd * MAX_SHARE_PER_PRODUCT;
  const { simpleOffers, catalog } = sources;
  const ok = catalog?.status === "ok" ? catalog : null;
  switch (bucket.id) {
    case "simple-flexible":
    case "simple-locked": {
      if (!simpleOffers) return { picks: [], gap: "no-snapshot" };
      const picks =
        bucket.id === "simple-flexible"
          ? simpleFlexible(bucket, simpleOffers, capUsd, ctx)
          : simpleLocked(bucket, simpleOffers, capUsd, ctx);
      return { picks, gap: null };
    }
    case "stable-yield":
    case "staking": {
      if (!ok) return { picks: [], gap: catalogGap(catalog) };
      const kinds = BUCKET_KINDS[bucket.id];
      const products = ok.yields.filter((y) => kinds.includes(y.kind));
      const candidates = available(products)
        .sort(byApr)
        .map((p) => yieldCandidate(p, capUsd));
      return {
        picks: splitEvenly(bucket.amountUsd, candidates, ctx),
        gap: null,
      };
    }
    case "onchain": {
      if (!ok) return { picks: [], gap: catalogGap(catalog) };
      const products = ok.yields.filter((y) => y.kind === "onchain");
      return { picks: onchain(bucket, products, totalUsd, ctx), gap: null };
    }
    case "dual": {
      if (!ok) return { picks: [], gap: catalogGap(catalog) };
      return { picks: dual(bucket, ok.dual, totalUsd, ctx), gap: null };
    }
    case "smart-arbitrage": {
      // API нет, сумма подбирается вручную — но место в лимите незащищённого капитала она занимает.
      ctx.unprotectedLeftUsd -= Math.min(
        bucket.amountUsd,
        ctx.unprotectedLeftUsd,
      );
      return { picks: [], gap: "manual" };
    }
  }
}

/**
 * Корзины, где капитал не защищён целиком, раскладываются первыми: они — доля профиля, а BFUSD в
 * «стейбл-доходной» корзине получает только остаток лимита (MAX_UNPROTECTED_SHARE).
 */
const FILL_ORDER: BucketId[] = [
  "dual",
  "onchain",
  "smart-arbitrage",
  "simple-flexible",
  "simple-locked",
  "stable-yield",
  "staking",
];

/** Корзины → конкретные продукты с лимитами диверсификации, ожидаемый доход и неразмещённый остаток. */
export function fillAllocation(
  buckets: Bucket[],
  sources: AllocationSources,
  profile: RiskProfile,
): AllocationPlan {
  const totalUsd = buckets.reduce((s, b) => s + b.amountUsd, 0);
  const ctx: FillContext = {
    unprotectedLeftUsd: totalUsd * MAX_UNPROTECTED_SHARE[profile],
    hitUnprotected: false,
    hitMinimum: false,
  };
  const filledById = new Map<BucketId, FilledBucket>();
  for (const bucket of [...buckets].sort(
    (a, b) => FILL_ORDER.indexOf(a.id) - FILL_ORDER.indexOf(b.id),
  )) {
    ctx.hitUnprotected = false;
    ctx.hitMinimum = false;
    const { picks, gap } = fillBucket(bucket, sources, totalUsd, ctx);
    const placed = picks.reduce((s, p) => s + p.amountUsd, 0);
    const unplacedUsd = Math.max(0, bucket.amountUsd - placed);
    const short = unplacedUsd > MIN_PICK_USD;
    const fallbackApr = short ? summaryApr(bucket.id, sources.summary) : null;
    filledById.set(bucket.id, {
      ...bucket,
      picks,
      unplacedUsd,
      gap:
        gap ??
        (!short
          ? null
          : ctx.hitUnprotected
            ? "unprotected-limit"
            : ctx.hitMinimum
              ? "below-minimum"
              : "no-products"),
      expectedIncomeUsd:
        picks.reduce((s, p) => s + p.amountUsd * p.apr, 0) +
        unplacedUsd * (fallbackApr ?? 0),
      estimated: fallbackApr !== null,
    });
  }
  const filled = buckets.flatMap((b) => filledById.get(b.id) ?? []);
  return {
    amountUsd: totalUsd,
    buckets: filled,
    expectedIncomeUsd: filled.reduce((s, b) => s + b.expectedIncomeUsd, 0),
    unfilledUsd: filled.reduce((s, b) => s + b.unplacedUsd, 0),
  };
}
