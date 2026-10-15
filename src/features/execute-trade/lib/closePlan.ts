// Закрытие зеркала по своим защитным ордерам (spec 0012, PR 2b): чистый выбор действий,
// сеть — model/closeDemoPosition.ts. Без ссылок (старые строки, ручные сделки) — по-старому.

/** Свой стоп или тейк на бирже: стоит (снять), сработал (позицию закрыла биржа), исполнено. */
export interface OwnLeg {
  active: boolean;
  triggered: boolean;
  /** Спот: сколько уже продано этим ордером (частичное исполнение тейка). */
  executedQty: number;
}

/** Ордера нет на бирже (снят без исполнения давно, не нашли) — ни снимать, ни считать сработавшим. */
const GONE: OwnLeg = { active: false, triggered: false, executedQty: 0 };

/**
 * Algo-ордер фьючерсов: сработал — есть actualOrderId (рыночный ордер, которым он исполнился) или
 * статус TRIGGERING/TRIGGERED/FINISHED; стоит — NEW. CANCELED/EXPIRED/REJECTED — неактивен.
 */
export function algoLeg(
  q: { algoStatus: string; actualOrderId: number | null } | null,
): OwnLeg {
  if (!q) return GONE;
  const triggered =
    q.actualOrderId !== null ||
    ["TRIGGERING", "TRIGGERED", "FINISHED"].includes(q.algoStatus);
  return {
    active: !triggered && q.algoStatus === "NEW",
    triggered,
    executedQty: 0,
  };
}

/**
 * Ордер спота: FILLED — сработал (монеты проданы); NEW/PENDING_NEW/PARTIALLY_FILLED — стоит
 * (частично исполненный тейк продолжает продавать — снимаем, остаток докрываем сами).
 */
export function spotLeg(
  q: { status: string; executedQty: number } | null,
): OwnLeg {
  if (!q) return GONE;
  if (q.status === "FILLED")
    return { active: false, triggered: true, executedQty: q.executedQty };
  return {
    active: ["NEW", "PENDING_NEW", "PARTIALLY_FILLED"].includes(q.status),
    triggered: false,
    executedQty: q.executedQty,
  };
}

export interface ClosePlan {
  /** Какие свои ордера снять (стоят на бирже). */
  cancel: ("stop" | "takeProfit")[];
  /** Сработал свой стоп/тейк — позицию уже закрыла биржа, докрывать нечего. */
  closedByExchange: boolean;
  /** Спот: продано своими ордерами частично — на столько меньше докрывать. */
  soldByLegs: number;
}

/**
 * Что делать при закрытии: снять свои стоящие ордера (и при сработавшем стопе — висящий тейк:
 * у фьючерсов algo TP/SL не связаны в OCO), понять, закрыла ли позицию биржа.
 */
export function planOwnClose(legs: {
  stop: OwnLeg | null;
  takeProfit: OwnLeg | null;
}): ClosePlan {
  const entries = [
    ["stop", legs.stop],
    ["takeProfit", legs.takeProfit],
  ] as const;
  return {
    cancel: entries.filter(([, l]) => l?.active).map(([k]) => k),
    closedByExchange: entries.some(([, l]) => l?.triggered),
    soldByLegs: entries.reduce((s, [, l]) => s + (l?.executedQty ?? 0), 0),
  };
}

/**
 * Сколько докрыть своим ордером: свой объём минус проданное своими ордерами, но не больше того,
 * что есть на бирже (фьючерсы — позиция в свою сторону, спот — монеты на балансе).
 */
export function ownCloseQuantity(
  own: number,
  soldByLegs: number,
  available: number,
): number {
  return Math.max(0, Math.min(own - soldByLegs, available));
}

/** Фьючерсы: сколько позиции в сторону сделки (позиция в другую сторону — не наша). */
export const positionOnSide = (amount: number, direction: "long" | "short") =>
  direction === "long" ? Math.max(amount, 0) : Math.max(-amount, 0);
