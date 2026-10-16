import { SPOT_TAKER_FEE } from "../config/spot";

// Закрытие зеркала по своим защитным ордерам (spec 0012, PR 2b): чистый выбор действий,
// сеть — model/closeDemoPosition.ts. Без ссылок (старые строки, ручные сделки) — по-старому.

/** Свой стоп или тейк на бирже: стоит (снять), сработал (позицию закрыла биржа), исполнено. */
export interface OwnLeg {
  active: boolean;
  triggered: boolean;
  /** Сколько уже закрыто этим ордером (спот — частичный тейк, фьючерсы — сработавшая нога). */
  executedQty: number;
  /** Сработал, а исполненный объём узнать не удалось (фьючерсы) — докрывать нельзя (PR 2d). */
  executedUnknown?: boolean;
}

/** Ордера нет на бирже (снят без исполнения давно, не нашли) — ни снимать, ни считать сработавшим. */
const GONE: OwnLeg = { active: false, triggered: false, executedQty: 0 };

/**
 * Algo-ордер фьючерсов: сработал — есть actualOrderId (рыночный ордер, которым он исполнился) или
 * статус TRIGGERING/TRIGGERED/FINISHED; стоит — NEW. CANCELED/EXPIRED/REJECTED — неактивен.
 */
export function algoLeg(
  q: { algoStatus: string; actualOrderId: number | null } | null,
  executedQty: number | null = null,
): OwnLeg {
  if (!q) return GONE;
  const triggered =
    q.actualOrderId !== null ||
    ["TRIGGERING", "TRIGGERED", "FINISHED"].includes(q.algoStatus);
  // Сработавшая нога закрыла executedQty своего объёма (actualQty или ордер по actualOrderId).
  const known = executedQty !== null && executedQty > 0;
  return {
    active: !triggered && q.algoStatus === "NEW",
    triggered,
    executedQty: triggered && known ? executedQty : 0,
    ...(triggered && !known ? { executedUnknown: true } : {}),
  };
}

/** Фьючерсы: сработала ли нога (до запроса исполненного объёма). */
export const algoTriggered = (
  q: { algoStatus: string; actualOrderId: number | null } | null,
) => algoLeg(q).triggered;

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
  /** Закрыто своими ордерами (спот — частичный тейк, фьючерсы — сработавшая нога) — на столько меньше докрывать. */
  soldByLegs: number;
  /** Своя нога сработала, а объём неизвестен — не докрывать (иначе можно закрыть объём соседей). */
  soldUnknown: boolean;
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
    soldUnknown: entries.some(([, l]) => l?.executedUnknown === true),
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

/**
 * Спот: сколько своих монет на балансе — купленное минус комиссия в покупаемой монете. Есть из
 * fills входа (protectRefs.netQuantity) — оно; нет — по ставке комиссии. Продавать больше нельзя:
 * разница — чужие монеты (демо 2026-10-15: куплено 150 S, пришло 149,85; закрытие продало 150).
 */
export function spotNetQuantity(
  netQuantity: number | null | undefined,
  bought: number,
  feeRate = SPOT_TAKER_FEE,
): number {
  return netQuantity ?? bought * (1 - feeRate);
}

/**
 * Средняя цена исполнения без хвоста плавающей точки (0.22210000000000002 → 0.2221): 10 значащих
 * знаков — точнее шага цены любой пары, расчёты PnL не меняются.
 */
export const averagePrice = (quote: number, quantity: number) =>
  Number((quote / quantity).toPrecision(10));

/** Ссылка на свой algo-ордер в protectRefs. */
export interface StoredAlgoRef {
  algoId: number | null;
  clientAlgoId: string | null;
}

/**
 * Чем искать/снимать свой algo-ордер: algoId, а если он неизвестен (исход постановки был
 * неизвестен и ордер не нашёлся) — clientAlgoId. Нет ни того ни другого — нечем (null).
 */
export function algoLookup(
  ref: StoredAlgoRef,
): { algoId: number } | { clientAlgoId: string } | null {
  if (ref.algoId !== null) return { algoId: ref.algoId };
  return ref.clientAlgoId ? { clientAlgoId: ref.clientAlgoId } : null;
}

/**
 * Стоп/тейк фьючерсов с неизвестным исходом постановки, перечитанный по своему clientAlgoId:
 * нашёлся стоящим или сработавшим — выставлен (algoId известен); не нашёлся или не прочитали — не
 * подтверждён, но ссылка по clientAlgoId сохраняется: закрытие найдёт и снимет его, если он всё же встал.
 */
export function afterAlgoUnknown(
  found:
    | { algoId: number; algoStatus: string; actualOrderId: number | null }
    | null
    | "error",
  clientAlgoId: string,
): { placed: boolean; ref: StoredAlgoRef } {
  if (found === null || found === "error")
    return { placed: false, ref: { algoId: null, clientAlgoId } };
  const leg = algoLeg(found);
  return {
    placed: leg.active || leg.triggered,
    ref: { algoId: found.algoId, clientAlgoId },
  };
}

/**
 * Итог закрытия после снятия своих ордеров: qty — сколько докрыть своим ордером (уже к шагу,
 * пыль — 0). Своя нога сработала, но своя позиция осталась (сработала частично, или closePosition
 * не всё закрыл) — докрываем, а не объявляем «закрыта биржей».
 */
export function closeVerdict(
  plan: Pick<ClosePlan, "closedByExchange" | "soldUnknown">,
  qty: number,
): "close" | "closedByExchange" | "nothingLeft" {
  // Сколько закрыла своя нога — неизвестно: на стороне могут быть соседи, лучше оставить свой хвост.
  if (plan.closedByExchange && plan.soldUnknown) return "closedByExchange";
  if (qty > 0) return "close";
  return plan.closedByExchange ? "closedByExchange" : "nothingLeft";
}

/**
 * Фьючерсы: своя нога сработала, вторая осталась. TP/SL на свой объём (reduceOnly + quantity, без
 * closePosition) биржа друг с другом не связывает — демо 2026-10-15: сработал тейк, стоп остался NEW
 * (и наоборот), а позиции уже нет. Висящий reduceOnly-стоп позже закрыл бы объём соседнего зеркала той
 * же монеты. Кандидат на снятие — открыта ровно одна своя нога из двух (обе есть в ссылках).
 */
export function orphanLegCandidate(
  refs: { stop: StoredAlgoRef | null; takeProfit: StoredAlgoRef | null },
  openAlgos: { algoId: number; clientAlgoId: string | null }[],
): {
  missing: "stop" | "takeProfit";
  remaining: "stop" | "takeProfit" | null;
} | null {
  const isOpen = (r: StoredAlgoRef) =>
    openAlgos.some(
      (a) =>
        (r.algoId !== null && a.algoId === r.algoId) ||
        (r.clientAlgoId !== null && a.clientAlgoId === r.clientAlgoId),
    );
  // Одна нога (stopOnly): пропала из открытых — кандидат «сработала», снимать нечего.
  if (refs.stop && !refs.takeProfit)
    return isOpen(refs.stop) ? null : { missing: "stop", remaining: null };
  if (!refs.stop || !refs.takeProfit) return null;
  const stopOpen = isOpen(refs.stop);
  const tpOpen = isOpen(refs.takeProfit);
  if (stopOpen === tpOpen) return null;
  return stopOpen
    ? { missing: "takeProfit", remaining: "stop" }
    : { missing: "stop", remaining: "takeProfit" };
}

/**
 * Своя нога сработала — чем это кончилось для позиции (ревью #80): исполнила объём — позицию закрыла
 * биржа; 0 — нога сработала раньше, чем исполнился вход («стоп до входа», доли секунды): позиция
 * открыта и без стопа — unprotected, вторую ногу (тейк) не снимаем.
 */
export const afterTriggeredLeg = (
  executedQty: number,
): "closed" | "unprotected" => (executedQty > 0 ? "closed" : "unprotected");
