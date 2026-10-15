import type { SymbolRules } from "@/shared/api/binance/demo.server";
import { floorToStep, stepDecimals } from "./validateTrade";

// Вход на споте (spec 0012, AC4): покупка и защита одной составной заявкой OTOCO/OTO.

/** Лимитная цена покупки выше текущей на эту долю — чтобы LIMIT FOK исполнился сразу, как рыночный. */
export const SPOT_ENTRY_SLIPPAGE = 0.005;
/**
 * Комиссия покупки на демо-споте — 0,1% (taker), удерживается в покупаемой монете (BNB на счёте
 * нет; проверено 2026-10-15: 40 BAT → комиссия 0,04 BAT). На столько меньше можно продать стопом.
 */
export const SPOT_TAKER_FEE = 0.001;

/** Округляет вверх к шагу цены. */
export function ceilToTick(value: number, tick: string): string {
  const t = Number(tick);
  return (Math.ceil(value / t - 1e-9) * t).toFixed(stepDecimals(tick));
}

export const spotEntryLimitPrice = (price: number, tickSize: string) =>
  ceilToTick(price * (1 + SPOT_ENTRY_SLIPPAGE), tickSize);

/** Сколько продавать стопом/тейком: куплено минус комиссия в монете, вниз к шагу. */
export const spotSellQuantity = (
  quantity: string,
  stepSize: string,
  feeRate = SPOT_TAKER_FEE,
) => floorToStep(Number(quantity) * (1 - feeRate), stepSize);

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
 * Встали ли отложенные ордера (стоп/тейк) после исполнения входа. Сразу после заявки биржа
 * отдаёт их как PENDING_NEW — статус надо перечитать.
 * placed — стоят (NEW) или уже сработали; failed — биржа их сняла/отклонила, монеты без защиты;
 * waiting — ещё PENDING_NEW (или статусов нет).
 */
export function pendingOutcome(
  statuses: string[],
): "placed" | "waiting" | "failed" {
  if (statuses.length === 0) return "waiting";
  if (statuses.some((s) => s === "FILLED" || s === "PARTIALLY_FILLED"))
    return "placed";
  if (
    statuses.some((s) =>
      ["EXPIRED", "EXPIRED_IN_MATCH", "REJECTED", "CANCELED"].includes(s),
    )
  )
    return "failed";
  if (statuses.some((s) => s === "PENDING_NEW")) return "waiting";
  return "placed";
}
