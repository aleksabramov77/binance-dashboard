import type { OrderListReports } from "./demoSchemas";
import type { SignedParams } from "./signed";

// Вход на споте одной составной заявкой (spec 0012): покупка + защита. Чистая часть — параметры
// запроса и разбор ответа; сеть — demoTrading.ts → demoSpotBuyProtected.

export interface SpotEntryListParams {
  symbol: string;
  /** Сколько купить (рабочий ордер LIMIT BUY FOK). */
  quantity: string;
  /** Лимитная цена покупки — чуть выше рынка, чтобы FOK исполнился сразу. */
  limitPrice: string;
  /** Сколько продавать стопом/тейком — купленное за вычетом комиссии в монете. */
  sellQuantity: string;
  stopLoss: string;
  /** null — только стоп (OTO), иначе тейк + стоп (OTOCO). */
  takeProfit: string | null;
}

/**
 * OTOCO (тейк LIMIT_MAKER выше + STOP_LOSS ниже) или OTO (только STOP_LOSS).
 * Рабочий ордер — FOK, а не IOC: отложенные ордера биржа ставит только после ПОЛНОГО исполнения
 * рабочего, а частично исполненный IOC истёк бы вместе с ними — монеты остались бы без стопа.
 * FOK — всё или ничего.
 */
export function spotEntryListRequest(p: SpotEntryListParams): {
  path: "/api/v3/orderList/otoco" | "/api/v3/orderList/oto";
  params: SignedParams;
} {
  const working = {
    symbol: p.symbol,
    workingType: "LIMIT",
    workingSide: "BUY",
    workingPrice: p.limitPrice,
    workingQuantity: p.quantity,
    workingTimeInForce: "FOK",
    pendingSide: "SELL",
    pendingQuantity: p.sellQuantity,
    newOrderRespType: "FULL",
  };
  if (p.takeProfit === null)
    return {
      path: "/api/v3/orderList/oto",
      params: {
        ...working,
        pendingType: "STOP_LOSS",
        pendingStopPrice: p.stopLoss,
      },
    };
  return {
    path: "/api/v3/orderList/otoco",
    params: {
      ...working,
      pendingAboveType: "LIMIT_MAKER",
      pendingAbovePrice: p.takeProfit,
      pendingBelowType: "STOP_LOSS",
      pendingBelowStopPrice: p.stopLoss,
    },
  };
}

export interface SpotEntryListResult {
  orderListId: number;
  /** Рабочий ордер (покупка): FILLED — исполнен целиком, EXPIRED — не исполнился (FOK). */
  workingStatus: string;
  workingOrderId: number;
  /** Куплено и потрачено USDT. */
  filled: number;
  quoteQty: number;
  /** Комиссия, удержанная в покупаемой монете. */
  baseCommission: number;
  /** Отложенные ордера: сразу после входа — PENDING_NEW, потом NEW. */
  pending: { orderId: number; type: string; status: string }[];
}

/** Разбор ответа OTO/OTOCO: рабочий ордер — BUY, отложенные — SELL. */
export function summarizeSpotEntryList(
  res: OrderListReports,
  baseAsset: string,
): SpotEntryListResult {
  const working = res.orderReports.find((r) => r.side === "BUY");
  return {
    orderListId: res.orderListId,
    workingStatus: working?.status ?? "UNKNOWN",
    workingOrderId: working?.orderId ?? 0,
    filled: working?.executedQty ?? 0,
    quoteQty: working?.cummulativeQuoteQty ?? 0,
    baseCommission: (working?.fills ?? [])
      .filter((f) => f.commissionAsset === baseAsset)
      .reduce((s, f) => s + f.commission, 0),
    pending: res.orderReports
      .filter((r) => r.side === "SELL")
      .map((r) => ({ orderId: r.orderId, type: r.type, status: r.status })),
  };
}
