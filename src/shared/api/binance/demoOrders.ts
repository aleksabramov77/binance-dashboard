import type { z } from "zod";
import type {
  algoHistorySchema,
  futuresAllOrdersSchema,
  spotAllOrdersSchema,
} from "./demoSchemas";

/** Чем исполнился ордер выхода: тейк, стоп, trailing-стоп или ликвидация. */
export type DemoCloseKind = "tp" | "sl" | "trailing" | "liquidation";

export interface DemoProtectiveStop {
  /** Сторона ордера стопа: SELL защищает лонг, BUY — шорт. */
  side: "BUY" | "SELL";
  triggerPrice: number;
  trailing: boolean;
  /** Сделка дашборда, чей это стоп (clientIdGroup); ручной/чужой — null. */
  group: string | null;
}

/** Ордера символа, нужные для статусов сделок. */
export interface DemoSymbolOrders {
  /** orderId исполненного ордера → чем он был (обычный ручной ордер в карте отсутствует). */
  closeKinds: Map<number, DemoCloseKind>;
  /** Активные защитные стопы (SL / trailing) по символу. */
  openStops: DemoProtectiveStop[];
  /**
   * orderId исполненного ордера → сделка дашборда (clientIdGroup): вход, свой TP/SL (у algo — по
   * actualOrderId), своё закрытие. Несколько сделок по одной монете не склеиваются (spec 0012, PR 2d).
   */
  groups: Map<number, string>;
}

/**
 * Сделка дашборда по clientOrderId / clientAlgoId: `bd<до 24 символов id сделки>-<роль>` (роль — L, W,
 * S, T, M, C, L2, S2, T2; см. execute-trade/lib/spotEntry → tradeClientIds). Чужой/ручной — null.
 */
export function clientIdGroup(
  clientId: string | null | undefined,
): string | null {
  const m = /^(bd[A-Za-z0-9]{1,24})-[A-Z][0-9]?$/.exec(clientId ?? "");
  return m ? m[1] : null;
}

const FUTURES_KIND: Record<string, DemoCloseKind> = {
  TAKE_PROFIT_MARKET: "tp",
  TAKE_PROFIT: "tp",
  STOP_MARKET: "sl",
  STOP: "sl",
  TRAILING_STOP_MARKET: "trailing",
  LIQUIDATION: "liquidation",
};

const SPOT_KIND: Record<string, DemoCloseKind> = {
  // Лимитный тейк в OCO — LIMIT_MAKER. Ручной LIMIT_MAKER вне OCO тоже считается TP:
  // дашборд таких не ставит, отличить по истории нельзя.
  LIMIT_MAKER: "tp",
  TAKE_PROFIT: "tp",
  TAKE_PROFIT_LIMIT: "tp",
  STOP_LOSS: "sl",
  STOP_LOSS_LIMIT: "sl",
};

/** Ликвидация и ADL на фьючерсах приходят ордерами с такими clientOrderId. */
const isLiquidationId = (clientOrderId: string) =>
  clientOrderId.startsWith("autoclose-") ||
  clientOrderId.startsWith("adl_autoclose");

const isStopType = (type: string) =>
  type.startsWith("STOP") || type === "TRAILING_STOP_MARKET";

const toStop = (
  type: string,
  side: DemoProtectiveStop["side"],
  triggerPrice: number,
  clientId: string | null,
): DemoProtectiveStop => ({
  side,
  triggerPrice,
  trailing: type === "TRAILING_STOP_MARKET",
  group: clientIdGroup(clientId),
});

/** Spot: тип исполненного ордера (OCO) и активные стоп-ордера. */
export function toSpotSymbolOrders(
  orders: z.infer<typeof spotAllOrdersSchema>,
): DemoSymbolOrders {
  const closeKinds = new Map<number, DemoCloseKind>();
  const openStops: DemoProtectiveStop[] = [];
  const groups = new Map<number, string>();
  for (const o of orders) {
    const kind = SPOT_KIND[o.type];
    if (o.status === "FILLED" && kind) closeKinds.set(o.orderId, kind);
    if (o.status === "NEW" && isStopType(o.type))
      openStops.push(toStop(o.type, o.side, o.stopPrice, o.clientOrderId));
    const group = clientIdGroup(o.clientOrderId);
    if (group) groups.set(o.orderId, group);
  }
  return { closeKinds, openStops, groups };
}

/**
 * Futures: TP/SL ставятся algo-ордерами — у сработавшего `actualOrderId` = id рыночного
 * ордера выхода. Ликвидации и обычные (не algo) стоп-ордера — из allOrders.
 */
export function toFuturesSymbolOrders(
  algos: z.infer<typeof algoHistorySchema>,
  orders: z.infer<typeof futuresAllOrdersSchema>,
): DemoSymbolOrders {
  const closeKinds = new Map<number, DemoCloseKind>();
  const openStops: DemoProtectiveStop[] = [];
  const groups = new Map<number, string>();
  for (const a of algos) {
    const kind = FUTURES_KIND[a.orderType];
    if (kind && a.actualOrderId !== null) closeKinds.set(a.actualOrderId, kind);
    if (a.algoStatus === "NEW" && isStopType(a.orderType))
      openStops.push(
        toStop(a.orderType, a.side, a.triggerPrice, a.clientAlgoId),
      );
    // Рыночный ордер, которым сработал свой TP/SL, — той же сделки, что и algo.
    const group = clientIdGroup(a.clientAlgoId);
    if (group && a.actualOrderId !== null) groups.set(a.actualOrderId, group);
  }
  for (const o of orders) {
    if (o.status === "NEW" && isStopType(o.type))
      openStops.push(toStop(o.type, o.side, o.stopPrice, o.clientOrderId));
    const group = clientIdGroup(o.clientOrderId);
    if (group && !groups.has(o.orderId)) groups.set(o.orderId, group);
    if (o.status !== "FILLED") continue;
    if (isLiquidationId(o.clientOrderId))
      closeKinds.set(o.orderId, "liquidation");
    else if (FUTURES_KIND[o.type] && !closeKinds.has(o.orderId))
      closeKinds.set(o.orderId, FUTURES_KIND[o.type]);
  }
  return { closeKinds, openStops, groups };
}
