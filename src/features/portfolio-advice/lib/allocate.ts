import type { Offer } from "@/entities/earn-offer";

interface Segment {
  rate: number;
  /** Ёмкость сегмента в USD. */
  capacityUsd: number;
}

export interface Allocation {
  offer: Offer;
  amountUsd: number;
  incomeUsd: number;
}

export interface AllocationResult {
  allocations: Allocation[];
  incomeUsd: number;
  /** Сколько не удалось разместить (у всех продуктов кончились лимиты). */
  unallocatedUsd: number;
  /** Ставка последнего заполненного сегмента — «цена» следующего доллара. */
  marginalApr: number;
}

/** Делит продукт на отрезки суммы с постоянной ставкой: бонусные ступени, затем база до лимита. */
export function offerSegments(offer: Offer): Segment[] {
  const price = offer.priceUsd;
  if (!price) return [];
  const cap = offer.maxPerUser ?? Number.POSITIVE_INFINITY;
  const points = [
    ...new Set([0, ...offer.tiers.flatMap((t) => [t.from, t.to])]),
  ]
    .filter((p) => p < cap)
    .sort((a, b) => a - b);
  points.push(cap);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    const mid = Number.isFinite(to) ? (from + to) / 2 : from + 1;
    const bonus = offer.tiers
      .filter((t) => mid >= t.from && mid < t.to)
      .reduce((s, t) => s + t.bonusApr, 0);
    segments.push({
      rate: offer.baseApr + bonus,
      capacityUsd: (to - from) * price,
    });
  }
  return segments;
}

/**
 * Жадно раскладывает `amountUsd` по продуктам: каждый следующий доллар — туда, где сейчас
 * самая высокая ставка. Отрезки одного продукта заполняются строго по порядку (сначала ступень
 * «до 10 000», потом остальное), поэтому раскладка всегда реализуема.
 */
export function allocate(amountUsd: number, offers: Offer[]): AllocationResult {
  const queues = offers.map((offer) => ({
    offer,
    segments: offerSegments(offer),
    index: 0,
    amountUsd: 0,
    incomeUsd: 0,
  }));
  let remaining = amountUsd;
  let marginalApr = 0;

  while (remaining > 1e-9) {
    let best: (typeof queues)[number] | null = null;
    for (const q of queues) {
      const head = q.segments[q.index];
      if (head && (!best || head.rate > best.segments[best.index].rate))
        best = q;
    }
    if (!best) break;
    const segment = best.segments[best.index];
    const take = Math.min(remaining, segment.capacityUsd);
    best.amountUsd += take;
    best.incomeUsd += take * segment.rate;
    remaining -= take;
    marginalApr = segment.rate;
    if (take >= segment.capacityUsd) best.index++;
    else segment.capacityUsd -= take;
  }

  const allocations = queues
    .filter((q) => q.amountUsd > 0)
    .map(({ offer, amountUsd: a, incomeUsd: i }) => ({
      offer,
      amountUsd: a,
      incomeUsd: i,
    }))
    .sort((a, b) => b.incomeUsd / b.amountUsd - a.incomeUsd / a.amountUsd);
  return {
    allocations,
    incomeUsd: allocations.reduce((s, a) => s + a.incomeUsd, 0),
    unallocatedUsd: Math.max(0, remaining),
    marginalApr,
  };
}
