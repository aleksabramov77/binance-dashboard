import {
  type FuturesSide,
  type FuturesSymbolState,
  nextRecheckDelay,
  type PositionMode,
  positionSideOf,
} from "@/shared/api/binance/demo.server";

// Фьючерсы в обоих режимах позиций (spec 0012, PR 2c): выбор режима, своя сторона, что снимать.
// Сеть — model/placeTrade.ts и model/closeDemoPosition.ts.

/**
 * Режим для входа. Hedge — как есть. One-way: автопереключение выключено (config/trade →
 * FUTURES_AUTO_HEDGE) — One-way; включено и счёт пуст (нет позиций и ордеров) — включить Hedge (иначе
 * биржа не даст: -4067/-4068); не пуст или проверить не удалось (null) — One-way. reason — для шага отчёта.
 */
export function choosePositionMode(
  current: PositionMode,
  accountBusy: boolean | null,
  autoHedge: boolean,
): {
  mode: PositionMode;
  enableHedge: boolean;
  reason: "hedge" | "autoHedgeOff" | "accountBusy" | "busyUnknown" | "switch";
} {
  if (current === "hedge")
    return { mode: "hedge", enableHedge: false, reason: "hedge" };
  if (!autoHedge)
    return { mode: "oneway", enableHedge: false, reason: "autoHedgeOff" };
  if (accountBusy === false)
    return { mode: "hedge", enableHedge: true, reason: "switch" };
  return {
    mode: "oneway",
    enableHedge: false,
    reason: accountBusy === null ? "busyUnknown" : "accountBusy",
  };
}

/**
 * Своя позиция: Hedge — строка своей стороны (LONG/SHORT), One-way — общая строка, если она в
 * сторону сделки (позиция в другую сторону — не наша). amount — без знака.
 */
export function ownPosition(
  rows: FuturesSymbolState["positions"],
  side: FuturesSide,
): { amount: number; entryPrice: number } {
  const ps = positionSideOf(side);
  const row =
    side.mode === "hedge"
      ? rows.find((r) => r.positionSide === ps)
      : rows.find((r) => r.positionSide === "BOTH" || r.amount !== 0);
  const signed = row?.amount ?? 0;
  const amount =
    side.mode === "hedge"
      ? Math.abs(signed)
      : side.direction === "long"
        ? Math.max(signed, 0)
        : Math.max(-signed, 0);
  return { amount, entryPrice: amount > 0 ? (row?.entryPrice ?? 0) : 0 };
}

/**
 * Занята ли своя сторона символа (ручной вход с /signals и зеркало): Hedge — позиция или ордера
 * своей стороны (другая сторона — отдельная позиция); One-way — любая позиция или ордер по символу:
 * маржу при ордерах не поменять, а вход в другую сторону закрыл бы чужую позицию.
 */
export function ownSideBusy(
  state: FuturesSymbolState,
  side: FuturesSide,
): boolean {
  if (side.mode === "oneway")
    return (
      state.positions.some((p) => p.amount !== 0) ||
      state.orders.length > 0 ||
      state.algos.length > 0
    );
  const ps = positionSideOf(side);
  return (
    ownPosition(state.positions, side).amount > 0 ||
    state.orders.some((o) => o.positionSide === ps) ||
    state.algos.some((a) => a.positionSide === ps)
  );
}

const exitSideOf = (side: FuturesSide) =>
  side.direction === "long" ? "SELL" : "BUY";

/**
 * Старые строки без protect_refs (и ручные сделки): снять только защитные ордера своей стороны —
 * algo TP/SL закрывающей стороны своего positionSide и обычные reduceOnly/closePosition ордера той же
 * стороны. Входы и ордера другой стороны (другие зеркала в Hedge, ручные) не трогаем. В One-way
 * защитные той же стороны на символе — наши, пока на монету одно зеркало (planMirror, до 2d).
 */
export function protectiveToCancel(
  state: Pick<FuturesSymbolState, "orders" | "algos">,
  side: FuturesSide,
): { algoIds: number[]; orderIds: number[] } {
  const ps = positionSideOf(side);
  const exit = exitSideOf(side);
  return {
    algoIds: state.algos
      .filter((a) => a.side === exit && a.positionSide === ps)
      .map((a) => a.algoId),
    orderIds: state.orders
      .filter(
        (o) =>
          o.side === exit &&
          o.positionSide === ps &&
          (o.reduceOnly || o.closePosition || ps !== "BOTH"),
      )
      .map((o) => o.orderId),
  };
}

/**
 * Спот, старые строки: защитные ордера зеркала — продажи (TP/SL/OCO лонга); покупки — чужие.
 * Ордер списка снимает весь список — по одному ордеру на список.
 */
export function spotProtectiveToCancel(
  orders: { orderId: number; orderListId: number; side: "BUY" | "SELL" }[],
): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const o of orders) {
    if (o.side !== "SELL") continue;
    if (o.orderListId !== -1) {
      if (seen.has(o.orderListId)) continue;
      seen.add(o.orderListId);
    }
    ids.push(o.orderId);
  }
  return ids;
}

/**
 * Порядок фьючерсной сделки. «Стоп до входа» (AC10) — только в Hedge (стоп с positionSide и
 * quantity без позиции; в One-way reduceOnly-стоп без позиции биржа не примет) и только за флагом:
 * на демо не проверено, принимает ли биржа такой стоп (счёт нельзя переключить — там позиции).
 */
export function futuresSequence(
  mode: PositionMode,
  stopBeforeEntry: boolean,
): "stopFirst" | "entryFirst" {
  return mode === "hedge" && stopBeforeEntry ? "stopFirst" : "entryFirst";
}

/**
 * Шаг перечитывания заявки с неизвестным исходом: нашлась — found; проверка начата после дедлайна
 * перечитывания — её «нет» окончательно (final); иначе ждать (wait). Общий дедлайн сделки
 * истёк раньше — giveUp: «нет» не окончательно, исход неизвестен (статус — не rejected).
 */
export function recheckStep(
  found: boolean,
  now: number,
  checkStartedAt: number,
  recheckDeadline: number,
  tradeDeadline: number,
): "found" | "final" | "giveUp" | { wait: number } {
  if (found) return "found";
  const delay = nextRecheckDelay(now, recheckDeadline, checkStartedAt);
  if (delay === null) return "final";
  if (now + delay > tradeDeadline) return "giveUp";
  return { wait: delay };
}
