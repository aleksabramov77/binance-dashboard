import { z } from "zod";
import type { AlgoOrderQuery, FuturesSymbolState } from "./demoSchemas";

// COIN-M (demo-dapi, spec 0056): стоп и тейк — обычные условные ордера `/dapi/v1/order` (STOP_MARKET /
// TAKE_PROFIT_MARKET со stopPrice), а не algo-ордера, как у USDⓈ-M с 2025 г. Проба на демо 2026-10-17: в Hedge
// биржа принимает их на свой объём с positionSide и без позиции («стоп до входа»), reduceOnly ставит сама
// (передать его в Hedge — -1106). Сработавший ордер — тот же orderId: type MARKET, origType прежний, status FILLED,
// executedQty и avgPrice — исполнение; соседняя нога остаётся NEW (биржа их не связывает). Чтобы логика защиты
// (lib/closePlan в execute-trade) была одна, ордер приводится к виду algo-ордера: algoId — его orderId,
// clientAlgoId — clientOrderId. Чистый модуль — тесты в coinmOrders.test.ts.

const decimal = z.coerce.number();

/** Ордер COIN-M (POST/GET/DELETE `/dapi/v1/order`, строки `/dapi/v1/openOrders`). */
export const coinmOrderSchema = z
  .object({
    orderId: z.number(),
    symbol: z.string().catch(""),
    clientOrderId: z.string().nullable().catch(null),
    status: z.string(),
    type: z.string().catch(""),
    origType: z.string().catch(""),
    side: z.enum(["BUY", "SELL"]),
    positionSide: z.string().catch("BOTH"),
    reduceOnly: z.boolean().catch(false),
    closePosition: z.boolean().catch(false),
    // POST без newOrderRespType=RESULT не присылает avgPrice — это не ошибка ордера.
    executedQty: decimal.catch(0),
    avgPrice: decimal.catch(0),
  })
  .loose();
export type CoinmOrder = z.infer<typeof coinmOrderSchema>;

export const coinmOrdersSchema = z.array(coinmOrderSchema);

/** Типы условных ордеров dapi: стоят до срабатывания триггера. */
const CONDITIONAL = new Set([
  "STOP",
  "STOP_MARKET",
  "TAKE_PROFIT",
  "TAKE_PROFIT_MARKET",
  "TRAILING_STOP_MARKET",
]);

/**
 * Условный ордер COIN-M в виде algo-ордера. Статусы: FILLED — FINISHED (сработал и исполнился), частично — TRIGGERED,
 * сработал и ещё не исполнился (type уже не тот, что origType) — TRIGGERING; NEW/CANCELED/EXPIRED/REJECTED — как
 * есть. actualOrderId — сам ордер, если он что-то исполнил: снятый после частичного исполнения тоже «сработал».
 */
export function coinmOrderAsAlgo(
  o: CoinmOrder,
): AlgoOrderQuery & { clientAlgoId: string | null } {
  const triggered = o.origType !== "" && o.type !== o.origType;
  const algoStatus =
    o.status === "FILLED"
      ? "FINISHED"
      : o.status === "PARTIALLY_FILLED"
        ? "TRIGGERED"
        : o.status === "NEW" && triggered
          ? "TRIGGERING"
          : o.status;
  return {
    algoId: o.orderId,
    clientAlgoId: o.clientOrderId,
    algoStatus,
    actualOrderId: o.executedQty > 0 ? o.orderId : null,
    actualPrice: o.avgPrice,
    actualQty: o.executedQty,
  };
}

/**
 * Открытые ордера символа COIN-M → состояние стороны: условные (ещё не сработавшие) — как algo-ордера (своя нога
 * ищется по algoId = orderId / clientAlgoId = clientOrderId), остальные — обычные.
 */
export function splitCoinmOpenOrders(
  orders: readonly CoinmOrder[],
): Pick<FuturesSymbolState, "orders" | "algos"> {
  const isConditional = (o: CoinmOrder) =>
    CONDITIONAL.has(o.type) && o.status === "NEW";
  return {
    orders: orders
      .filter((o) => !isConditional(o))
      .map((o) => ({
        orderId: o.orderId,
        side: o.side,
        positionSide: o.positionSide,
        type: o.type,
        reduceOnly: o.reduceOnly,
        closePosition: o.closePosition,
      })),
    algos: orders.filter(isConditional).map((o) => ({
      algoId: o.orderId,
      clientAlgoId: o.clientOrderId,
      symbol: o.symbol,
      side: o.side,
      positionSide: o.positionSide,
      orderType: o.type,
    })),
  };
}

/** Пара позиций COIN-M для `/dapi/v1/positionRisk` (параметра symbol у dapi нет): BTCUSD_PERP → BTCUSD. */
export const coinmPair = (symbol: string) => symbol.replace(/_[A-Z0-9]+$/, "");
