import { evaluateOffer, type Offer } from "@/entities/earn-offer";
import {
  type AdvancedCatalog,
  type DualOffer,
  distanceToStrike,
  type KindSummary,
  type YieldProduct,
} from "@/entities/earn-product";
import { isStablecoin } from "@/shared/config";
import { BUCKET_KINDS, type BucketId } from "../config/profiles";
import {
  DUAL_MAX_DAYS,
  DUAL_MAX_PICKS,
  DUAL_MIN_DISTANCE,
  LOCK_LADDER,
  MAX_SHARE_PER_DUAL_OFFER,
  MAX_SHARE_PER_PRODUCT,
  MAX_SHARE_PER_PROTOCOL,
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
}

/** Жадно раскладывает сумму по кандидатам (уже отсортированным), каждому — не больше его лимита. */
function distribute(amountUsd: number, candidates: Candidate[]) {
  const picks: AllocationPick[] = [];
  let left = amountUsd;
  for (const c of candidates) {
    if (left < 0.01) break;
    const amount = Math.min(left, c.limitUsd);
    if (amount < 0.01) continue;
    picks.push({
      id: c.id,
      label: c.label,
      amountUsd: amount,
      apr: c.apr,
      note: c.note ?? null,
    });
    left -= amount;
  }
  return picks;
}

/** Делит сумму поровну между кандидатами; не влезшее в лимит одного достаётся следующим. */
function splitEvenly(amountUsd: number, candidates: Candidate[]) {
  const picks: AllocationPick[] = [];
  let left = amountUsd;
  candidates.forEach((c, i) => {
    const fair = left / (candidates.length - i);
    const amount = Math.min(fair, c.limitUsd);
    if (amount < 0.01) return;
    picks.push({
      id: c.id,
      label: c.label,
      amountUsd: amount,
      apr: c.apr,
      note: c.note ?? null,
    });
    left -= amount;
  });
  return picks;
}

function simpleFlexible(bucket: Bucket, offers: Offer[], capUsd: number) {
  const candidates = offers
    .filter((o) => o.type === "flexible" && o.stablecoin && !o.soldOut)
    .map((o) => ({
      offer: o,
      y: evaluateOffer(o, Math.min(bucket.amountUsd, capUsd)),
    }))
    .filter((c) => c.y && !c.y.belowMinimum)
    .sort((a, b) => (b.y?.effectiveApr ?? 0) - (a.y?.effectiveApr ?? 0))
    .map(
      ({ offer, y }): Candidate => ({
        id: offer.id,
        label: `${offer.asset} Flexible`,
        apr: y?.effectiveApr ?? offer.baseApr,
        limitUsd: capUsd,
      }),
    );
  return distribute(bucket.amountUsd, candidates);
}

/** Лестница Locked: сумма поровну на сроки LOCK_LADDER, на каждом — лучший стейбл-продукт ближайшего срока. */
function simpleLocked(bucket: Bucket, offers: Offer[], capUsd: number) {
  const locked = offers.filter(
    (o) => o.type === "locked" && o.stablecoin && !o.soldOut,
  );
  const rungUsd = bucket.amountUsd / LOCK_LADDER.length;
  const picks: AllocationPick[] = [];
  for (const rung of LOCK_LADDER) {
    const nearest = Math.min(
      ...locked.map((o) => Math.abs(o.durationDays - rung)),
    );
    const best = locked
      .filter((o) => Math.abs(o.durationDays - rung) === nearest)
      .filter((o) => !picks.some((p) => p.id === o.id))
      .map((o) => ({ offer: o, y: evaluateOffer(o, rungUsd) }))
      .filter((c) => c.y && !c.y.belowMinimum)
      .sort((a, b) => (b.y?.effectiveApr ?? 0) - (a.y?.effectiveApr ?? 0))[0];
    if (!best?.y) continue;
    // Разные сроки — разные продукты, поэтому лимит на продукт проверяется по ступени.
    const amount = Math.min(rungUsd, capUsd);
    picks.push({
      id: best.offer.id,
      label: `${best.offer.asset} Locked ${best.offer.durationDays} дн.`,
      amountUsd: amount,
      apr: best.y.effectiveApr,
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
  };
}

/** DeFi: стейблкоины первыми, не больше одного продукта и MAX_SHARE_PER_PROTOCOL на протокол. */
function onchain(bucket: Bucket, products: YieldProduct[], totalUsd: number) {
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
  return distribute(bucket.amountUsd, candidates);
}

/** Dual: только Buy Low на стейблах (у вас доллары), цель ≥ 5 % ниже цены, срок ≤ 14 дней, лучшее по монете. */
function dual(bucket: Bucket, offers: DualOffer[], totalUsd: number) {
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
    .map((o) => ({
      id: o.id,
      label: `${o.coin} Buy Low ${o.durationDays} дн.`,
      apr: o.apr,
      note: `купите ${o.coin}, если цена упадёт до ${Math.round(o.strikePrice)} ${o.stable}`,
      limitUsd: Math.min(cap, o.maxAmount > 0 ? o.maxAmount : cap),
    }));
  return splitEvenly(bucket.amountUsd, candidates);
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
          ? simpleFlexible(bucket, simpleOffers, capUsd)
          : simpleLocked(bucket, simpleOffers, capUsd);
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
      return { picks: splitEvenly(bucket.amountUsd, candidates), gap: null };
    }
    case "onchain": {
      if (!ok) return { picks: [], gap: catalogGap(catalog) };
      const products = ok.yields.filter((y) => y.kind === "onchain");
      return { picks: onchain(bucket, products, totalUsd), gap: null };
    }
    case "dual": {
      if (!ok) return { picks: [], gap: catalogGap(catalog) };
      return { picks: dual(bucket, ok.dual, totalUsd), gap: null };
    }
    case "smart-arbitrage":
      return { picks: [], gap: "manual" };
  }
}

/** Корзины → конкретные продукты с лимитами диверсификации, ожидаемый доход и неразмещённый остаток. */
export function fillAllocation(
  buckets: Bucket[],
  sources: AllocationSources,
): AllocationPlan {
  const totalUsd = buckets.reduce((s, b) => s + b.amountUsd, 0);
  const filled = buckets.map((bucket): FilledBucket => {
    const { picks, gap } = fillBucket(bucket, sources, totalUsd);
    const placed = picks.reduce((s, p) => s + p.amountUsd, 0);
    const unplacedUsd = Math.max(0, bucket.amountUsd - placed);
    const fallbackApr =
      unplacedUsd > 0.01 ? summaryApr(bucket.id, sources.summary) : null;
    return {
      ...bucket,
      picks,
      unplacedUsd,
      gap: gap ?? (unplacedUsd > 0.01 ? "no-products" : null),
      expectedIncomeUsd:
        picks.reduce((s, p) => s + p.amountUsd * p.apr, 0) +
        unplacedUsd * (fallbackApr ?? 0),
      estimated: fallbackApr !== null,
    };
  });
  return {
    amountUsd: totalUsd,
    buckets: filled,
    expectedIncomeUsd: filled.reduce((s, b) => s + b.expectedIncomeUsd, 0),
    unfilledUsd: filled.reduce((s, b) => s + b.unplacedUsd, 0),
  };
}
