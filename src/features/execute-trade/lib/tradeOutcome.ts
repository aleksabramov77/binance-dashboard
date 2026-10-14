import type { TradeResult } from "@/entities/trade";

// Выбор исхода сделки по результатам шагов placeTrade (spec 0012): чистые функции, сеть — в model.
// Правило: позиция без стопа — только unprotected; rejected — только когда позиции точно нет.

/** Итог сделки: статус, текст и попадают ли в результат цена входа и объём (позиция есть). */
export interface TradeOutcome {
  status: TradeResult["status"];
  message: string;
  withEntry: boolean;
}

const outcome = (
  status: TradeResult["status"],
  message: string,
  withEntry = false,
): TradeOutcome => ({ status, message, withEntry });

/** Как понимать ошибку отправки ордера (shared/api/binance → orderErrorOutcome). */
export type OrderFailure = "rejected" | "unknown";

export const PROTECTED_MESSAGE = "Позиция открыта, TP и SL выставлены.";
export const STOP_ONLY_MESSAGE =
  "Позиция открыта, стоп выставлен (тейка нет — выход по стратегии).";
const protectedOutcome = (stopOnly: boolean) =>
  outcome("protected", stopOnly ? STOP_ONLY_MESSAGE : PROTECTED_MESSAGE, true);

const UNKNOWN_BUY =
  "Неизвестно, исполнилась ли покупка, — проверьте баланс и ордера на demo.binance.com.";
const UNKNOWN_FUTURES =
  "Неизвестно, открылась ли позиция, — проверьте на demo.binance.com и при необходимости поставьте стоп вручную.";

/**
 * Вход не отправился: биржа отказала — позиции точно нет; исход неизвестен (-1007, 5xx, сеть) —
 * recheck: фьючерсы — проверить позицию, спот — перечитать заявку по своему clientOrderId.
 */
export function afterEntryError(
  failure: OrderFailure,
  entry: "futures" | "spotList" | "spotMarket",
): TradeOutcome | "recheck" {
  if (failure === "unknown") return "recheck";
  return outcome(
    "rejected",
    entry === "spotList"
      ? "Биржа отклонила заявку — монеты не куплены."
      : "Биржа отклонила вход — позиция не открыта.",
  );
}

/**
 * Фьючерсы, исход входа неизвестен: позиция на бирже (null — проверить не удалось).
 * Позиция есть — { protect }: ставить защиту на неё.
 */
export function afterFuturesPositionCheck<P extends { amount: number }>(
  position: P | null,
): TradeOutcome | { protect: P } {
  if (position === null) return outcome("unprotected", UNKNOWN_FUTURES);
  if (position.amount === 0)
    return outcome("rejected", "Вход не исполнился — позиции на бирже нет.");
  return { protect: position };
}

/** Фьючерсы: стоп после входа. Не встал — откат (позиция без стопа не остаётся, AC5). */
export function afterFuturesStop(
  placed: boolean,
  stopOnly: boolean,
): TradeOutcome | "rollback" | "takeProfit" {
  if (!placed) return "rollback";
  return stopOnly ? protectedOutcome(true) : "takeProfit";
}

/**
 * Фьючерсы: тейк после стопа. Не встал — стоп всё равно защищает от убытка, а выйдет позиция вместе с
 * paper-сделкой: protected, как на споте при снятом биржей тейке (решение пользователя 2026-10-15).
 */
export function afterFuturesTakeProfit(placed: boolean): TradeOutcome {
  return placed
    ? protectedOutcome(false)
    : outcome(
        "protected",
        "Позиция открыта, стоп стоит, тейк не выставился (выход — вместе с paper-сделкой).",
        true,
      );
}

/** Фьючерсы: откат после отказа стопа. Закрыли — rejected без цены входа (в демо-PnL не попадёт). */
export function afterFuturesRollback(closed: boolean): TradeOutcome {
  return closed
    ? outcome(
        "rejected",
        "Стоп не принят биржей — позиция сразу закрыта по рынку.",
      )
    : outcome(
        "unprotected",
        "Стоп не принят биржей, и закрыть позицию по рынку не удалось — закройте её на demo.binance.com.",
        true,
      );
}

/**
 * Спот, исход отправки неизвестен — заявку перечитали по clientOrderId: missing — её на бирже нет
 * (монеты не куплены), error — перечитать не удалось; нашли — { found }: дальше как с ответом биржи.
 */
export function afterSpotRecheck<T extends object>(
  rechecked: T | "missing" | "error",
): TradeOutcome | { found: T } {
  if (rechecked === "missing")
    return outcome("rejected", "Заявки на бирже нет — монеты не куплены.");
  if (rechecked === "error") return outcome("unprotected", UNKNOWN_BUY);
  return { found: rechecked };
}

const FINAL_UNFILLED = ["EXPIRED", "EXPIRED_IN_MATCH", "REJECTED", "CANCELED"];

/**
 * Спот: статус покупки (рабочего ордера OTO/OTOCO или рыночного). filled — куплена целиком;
 * partial — куплено частично, защищать купленное отдельно; покупка не исполнилась (FOK истёк) —
 * rejected; иной статус без покупки (ещё в работе) — неизвестно, unprotected.
 */
export function afterSpotBuy(
  status: string,
  filled: number,
  entry: "spotList" | "spotMarket",
): TradeOutcome | "filled" | "partial" {
  if (status === "FILLED") return "filled";
  if (filled > 0) return "partial";
  if (FINAL_UNFILLED.includes(status))
    return outcome(
      "rejected",
      entry === "spotList"
        ? "Покупка не исполнилась по цене до +0,5% — монеты не куплены."
        : "Покупка не исполнилась — монеты не куплены.",
    );
  return outcome("unprotected", UNKNOWN_BUY);
}

/** Спот: отложенные ордера после покупки (lib/spotEntry → pendingOutcome). */
export function afterPending(
  pending: "placed" | "stopOnly" | "waiting" | "failed",
  stopOnly: boolean,
): TradeOutcome | "protect" {
  if (pending === "placed") return protectedOutcome(stopOnly);
  // Стоп стоит, тейк снят биржей: позиция защищена, повторная защита/продажа не нужна.
  if (pending === "stopOnly")
    return outcome(
      "protected",
      "Позиция открыта, стоп стоит, тейк снят биржей.",
      true,
    );
  if (pending === "waiting")
    return outcome(
      "unprotected",
      "Куплено, но стоп ещё не подтверждён биржей — проверьте ордера на demo.binance.com.",
      true,
    );
  return "protect";
}

/**
 * Спот: защита купленного (стоп или OCO). Биржа отказала — продать купленное; исход неизвестен —
 * стоп мог встать, продавать нельзя: unprotected.
 */
export function afterProtect(
  result: "placed" | OrderFailure,
  stopOnly: boolean,
): TradeOutcome | "sell" {
  if (result === "placed") return protectedOutcome(stopOnly);
  if (result === "rejected") return "sell";
  return outcome(
    "unprotected",
    "Куплено, но неизвестно, встала ли защита, — проверьте ордера на demo.binance.com.",
    true,
  );
}

/** Спот: продажа купленного после отказа защиты. Продали — сделка не открылась (rejected). */
export function afterSell(sold: boolean): TradeOutcome {
  return sold
    ? outcome(
        "rejected",
        "Стоп не принят биржей — купленное сразу продано по рынку.",
      )
    : outcome(
        "unprotected",
        "Куплено, но защита не выставилась и продать не удалось — закройте позицию вручную на demo.binance.com.",
        true,
      );
}
