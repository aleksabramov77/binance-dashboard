import type { TradeResult } from "@/entities/trade";
import { SPOT_ENTRY_SLIPPAGE_TEXT } from "../config/spot";
import { FUTURES_GROWTH_TOLERANCE } from "../config/trade";

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
 * Итог сделки, чей вход биржа не подтвердила (свой `-M` не найден), а позиция на пустой до входа
 * стороне появилась: защита выставлена, но статус — unprotected, чтобы человек проверил (PR 2e).
 */
export const UNCONFIRMED_ENTRY = outcome(
  "unprotected",
  "Вход не подтверждён биржей (свой ордер не найден), но позиция появилась — защита выставлена, проверьте на demo.binance.com.",
  true,
);

/**
 * Фьючерсы, исход входа неизвестен, свой ордер `-M` не подтверждён — сверка по позиции своей стороны
 * (null — проверить не удалось) относительно снимка до входа (before): на стороне могут быть позиции
 * других зеркал (PR 2d), их объём — не наш. { protect } — свой объём (прирост), entryPrice null —
 * средняя цена стороны не наша, берём текущую.
 * - свой ордер не найден и после дедлайна (missing; поиск — до отправки + recvWindow, позже биржа его не
 *   примет): прироста нет — вход не прошёл; сторона до входа была пуста и выросла — позиция почти
 *   наверняка своя (с блокировкой прогона параллельного входа соседа нет): защищаем её, но итог —
 *   unprotected «вход не подтверждён» ({ protect, unconfirmed }); сторона не была пуста — прирост может
 *   быть входом соседа: unprotected без защиты и отката (PR 2e);
 * - ордер не прочитан (unknown), сторона до входа пуста: позиция есть — вся она наша, нет — вход не прошёл;
 * - unknown, сторона не пуста: прирост ≈ объёму заявки (FUTURES_GROWTH_TOLERANCE) — защищаем прирост;
 *   прироста нет — вход не прошёл; иначе неясно, чей объём, — unprotected без защиты и отката.
 */
export function afterFuturesPositionCheck(
  position: { amount: number; entryPrice: number } | null,
  before: number,
  order: "missing" | "unknown",
  expectedQty: number,
):
  | TradeOutcome
  | {
      protect: { amount: number; entryPrice: number | null };
      /** Свой ордер входа не найден — защиту ставим, но итог сделки — UNCONFIRMED_ENTRY. */
      unconfirmed?: true;
    } {
  if (position === null) return outcome("unprotected", UNKNOWN_FUTURES);
  // Свой ордер `-M` не найден и после дедлайна: прирост стороны, даже ≈ заявке, может быть входом
  // соседнего зеркала (параллельный прогон) — не защищаем его как свой и не откатываем (PR 2e).
  if (order === "missing") {
    const grown = position.amount - before;
    if (grown > expectedQty * FUTURES_GROWTH_TOLERANCE && before <= 0)
      return { protect: position, unconfirmed: true };
    if (grown > expectedQty * FUTURES_GROWTH_TOLERANCE)
      return outcome(
        "unprotected",
        "Свой ордер входа на бирже не найден, а позиция стороны выросла — возможно, это вход другого зеркала: защиту и откат не ставили, проверьте на demo.binance.com.",
      );
    return outcome(
      "rejected",
      before > 0
        ? "Вход не исполнился — своего ордера на бирже нет, сторона не выросла (её держат другие зеркала)."
        : "Вход не исполнился — позиции на бирже нет.",
    );
  }
  if (before <= 0) {
    if (position.amount === 0)
      return outcome("rejected", "Вход не исполнился — позиции на бирже нет.");
    return { protect: position };
  }
  const growth = position.amount - before;
  const tolerance = expectedQty * FUTURES_GROWTH_TOLERANCE;
  if (Math.abs(growth - expectedQty) <= tolerance)
    return { protect: { amount: growth, entryPrice: null } };
  if (Math.abs(growth) <= tolerance)
    return outcome(
      "rejected",
      "Вход не исполнился — сторона не выросла (её держат другие зеркала).",
    );
  return outcome(
    "unprotected",
    "Неизвестно, исполнился ли свой вход: сторона уже открыта другими зеркалами, прирост не совпал с заявкой — защиту и откат не ставили, проверьте на demo.binance.com.",
  );
}

const FUTURES_FINAL = [
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
];

/**
 * Фьючерсы, исход входа неизвестен: свой ордер входа, перечитанный по clientOrderId (PR 2b).
 * Исполнен — { filled } (объём и цена из ордера); завершён без исполнения — rejected;
 * не найден, ещё в работе или не прочитали — сверить по позиции символа.
 */
export function afterFuturesOrderCheck<
  O extends { status: string; executedQty: number },
>(order: O | null | "error"): TradeOutcome | { filled: O } | "checkPosition" {
  if (order === null || order === "error") return "checkPosition";
  if (order.executedQty > 0) return { filled: order };
  if (FUTURES_FINAL.includes(order.status))
    return outcome(
      "rejected",
      `Вход не исполнился — ордер на бирже ${order.status}, позиции нет.`,
    );
  return "checkPosition";
}

/**
 * Фьючерсы, «стоп до входа» (AC10, Hedge, за флагом): стоп не встал — вход не отправляется,
 * позиции нет.
 */
export function afterStopBeforeEntry(placed: boolean): TradeOutcome | "enter" {
  return placed
    ? "enter"
    : outcome("rejected", "Стоп не принят биржей — вход не отправлялся.");
}

/** Общий срок сделки истёк до отправки входа — ничего не отправлено. */
export const DEADLINE_BEFORE_ENTRY = outcome(
  "rejected",
  "Биржа долго не отвечает — вход не отправлялся, попробуйте позже.",
);

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
        ? `Покупка не исполнилась по цене до +${SPOT_ENTRY_SLIPPAGE_TEXT} — монеты не куплены.`
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
 * Спот: стоп OTOCO снят биржей, перед повторной защитой — свой тейк того же списка (PR 2b).
 * Он держит купленные монеты: новая защита/продажа упёрлась бы в баланс. Стоит (NEW, PENDING_NEW,
 * частично исполнен) — снять адресно по своему id; исполнен — монеты проданы тейком, защита не
 * нужна; снят/нет/не прочитан — защищать сразу (не прочитан: снять нечего найти — защита или
 * продажа сами упрутся в баланс и уйдут в unprotected).
 */
export function afterStopLost(
  takeProfit: { status: string; executedQty: number } | null,
): "protect" | "cancelTakeProfit" | TradeOutcome {
  if (!takeProfit) return "protect";
  if (takeProfit.status === "FILLED")
    return outcome(
      "protected",
      "Стоп снят биржей, но позиция уже закрыта тейком.",
      true,
    );
  if (["NEW", "PENDING_NEW", "PARTIALLY_FILLED"].includes(takeProfit.status))
    return "cancelTakeProfit";
  return "protect";
}

/** Свой тейк не удалось снять — он мог исполниться: не продаём и не перезащищаем, тревога. */
export function afterTakeProfitCancel(
  cancelled: boolean,
): "protect" | TradeOutcome {
  return cancelled
    ? "protect"
    : outcome(
        "unprotected",
        "Стоп снят биржей, а свой тейк снять не удалось — проверьте ордера на demo.binance.com.",
        true,
      );
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
