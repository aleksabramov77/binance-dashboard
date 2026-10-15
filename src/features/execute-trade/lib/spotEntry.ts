import type {
  SpotEntryClientIds,
  SpotEntryListResult,
  SpotOrderQuery,
  SymbolRules,
} from "@/shared/api/binance/demo.server";
import { SPOT_ENTRY_SLIPPAGE, SPOT_TAKER_FEE } from "../config/spot";
import { stepDecimals } from "./validateTrade";

// Вход на споте (spec 0012, AC4): покупка и защита одной составной заявкой OTOCO/OTO.

/** Округляет вверх к шагу цены. */
export function ceilToTick(value: number, tick: string): string {
  const t = Number(tick);
  return (Math.ceil(value / t - 1e-9) * t).toFixed(stepDecimals(tick));
}

export const spotEntryLimitPrice = (price: number, tickSize: string) =>
  ceilToTick(price * (1 + SPOT_ENTRY_SLIPPAGE), tickSize);

/**
 * Как входить: OTOCO (тейк + стоп), OTO (только стоп) или, если биржа не разрешает составные
 * заявки по символу, — по-старому: покупка по рынку, потом защита (при её отказе — продажа).
 */
export function chooseSpotEntry(
  rules: Pick<SymbolRules, "otoAllowed" | "ocoAllowed">,
  stopOnly: boolean,
): "otoco" | "oto" | "market" {
  if (!rules.otoAllowed) return "market";
  if (stopOnly) return "oto";
  return rules.ocoAllowed ? "otoco" : "market";
}

/**
 * Свои clientOrderId сделки (≤ 36 символов, [A-Za-z0-9_-]): по ним перечитываем заявку, если исход
 * неизвестен (-1007, 5xx, обрыв сети), и закрытие находит свои стоп/тейк (PR 2b). prefix — из id
 * сделки, чтобы связать ордера с журналом. Спот: OTO/OTOCO — L/W/S/T, рыночная покупка — M,
 * отдельная защита после покупки (OCO/стоп) — L2/S2/T2: id ордеров OTOCO могут быть ещё заняты.
 * Фьючерсы: вход — M, algo-стоп и тейк — S/T (clientAlgoId).
 */
export function tradeClientIds(tradeId: string): SpotEntryClientIds & {
  market: string;
  /** Своё закрытие по рынку (откат, продажа при отказе защиты, закрытие зеркала). */
  close: string;
  protectList: string;
  protectStop: string;
  protectTakeProfit: string;
} {
  const prefix = `bd${tradeId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
  return {
    list: `${prefix}-L`,
    working: `${prefix}-W`,
    stop: `${prefix}-S`,
    takeProfit: `${prefix}-T`,
    market: `${prefix}-M`,
    close: `${prefix}-C`,
    protectList: `${prefix}-L2`,
    protectStop: `${prefix}-S2`,
    protectTakeProfit: `${prefix}-T2`,
  };
}

const STOP_TYPES = ["STOP_LOSS", "STOP_LOSS_LIMIT"];
const DEAD = ["EXPIRED", "EXPIRED_IN_MATCH", "REJECTED", "CANCELED"];

/**
 * Встали ли отложенные ордера (стоп/тейк) после исполнения входа. Сразу после заявки биржа
 * отдаёт их как PENDING_NEW — статус надо перечитать.
 * placed — стоят (NEW) или уже сработали; stopOnly — стоп стоит, а тейк биржа сняла (позиция
 * защищена, снимать и ставить заново ничего не нужно); failed — стоп снят/отклонён, монеты без
 * защиты; waiting — стоп ещё PENDING_NEW (или статусов нет).
 */
export function pendingOutcome(
  orders: { type: string; status: string }[],
): "placed" | "stopOnly" | "waiting" | "failed" {
  if (orders.length === 0) return "waiting";
  // Нога исполнилась целиком — позиция уже продана (вторую ногу OCO биржа снимает сама).
  if (orders.some((o) => o.status === "FILLED")) return "placed";
  const stop = orders.find((o) => STOP_TYPES.includes(o.type));
  const anyDead = orders.some((o) => DEAD.includes(o.status));
  // Стопа в списке нет (в ответе биржи он есть всегда; при перечитывании по clientOrderId его могли
  // не найти) — защита не подтверждена: никогда не placed.
  if (!stop) return anyDead ? "failed" : "waiting";
  // Стоп снят — защиты нет; стоп частично сработал — он жив и продаёт остаток.
  if (DEAD.includes(stop.status)) return "failed";
  if (stop.status === "PARTIALLY_FILLED") return "placed";
  if (orders.some((o) => o.status === "PENDING_NEW")) return "waiting";
  return anyDead ? "stopOnly" : "placed";
}

/**
 * Заявка OTO/OTOCO, перечитанная по clientOrderId (исход отправки был неизвестен), в том же виде,
 * что ответ биржи. GET /api/v3/order не отдаёт комиссию — берём ставку SPOT_TAKER_FEE.
 */
export function spotEntryFromQuery(
  working: SpotOrderQuery,
  pending: SpotOrderQuery[],
  feeRate = SPOT_TAKER_FEE,
): SpotEntryListResult {
  return {
    orderListId: working.orderListId,
    workingStatus: working.status,
    workingOrderId: working.orderId,
    filled: working.executedQty,
    quoteQty: working.cummulativeQuoteQty,
    baseCommission: working.executedQty * feeRate,
    pending: pending.map((p) => ({
      orderId: p.orderId,
      type: p.type,
      status: p.status,
    })),
  };
}
