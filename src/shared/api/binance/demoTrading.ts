import { isStablecoin } from "@/shared/config";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { getJsonWithRetry, HttpError } from "@/shared/lib/fetchRetry";
import {
  type SpotEntryListParams,
  type SpotEntryListResult,
  spotEntryListRequest,
  summarizeSpotEntryList,
} from "./demoOrderLists";
import {
  type DemoSymbolOrders,
  toFuturesSymbolOrders,
  toSpotSymbolOrders,
} from "./demoOrders";
import { type SymbolRules, toRules } from "./demoRules";
import {
  type AlgoOrderQuery,
  algoHistorySchema,
  algoOrderQuerySchema,
  algoOrderSchema,
  anySchema,
  coinmBalancesSchema,
  exchangeInfoSchema,
  type FuturesOrder,
  type FuturesSymbolState,
  futuresAccountAssetsSchema,
  futuresAllOrdersSchema,
  futuresBalancesSchema,
  futuresOpenAlgoOrdersSchema,
  futuresOpenOrdersSchema,
  futuresOrderSchema,
  futuresUserTradesSchema,
  orderListReportsSchema,
  orderListSchema,
  positionModeSchema,
  positionRiskSchema,
  priceSchema,
  type SpotOpenOrder,
  type SpotOrder,
  type SpotOrderQuery,
  spotAccountBalancesSchema,
  spotAllOrdersSchema,
  spotMyTradesSchema,
  spotOpenOrdersSchema,
  spotOrderQuerySchema,
  spotOrderSchema,
  spotOrderStatusSchema,
  symbolRowsSchema,
} from "./demoSchemas";
import type { Market } from "./market";
import type { BinanceMarket } from "./markets";
import { ORDER_RECV_WINDOW_MS } from "./orderOutcome";
import {
  entryParams,
  type FuturesSide,
  type PositionMode,
  protectParams,
  reduceParams,
} from "./positionMode";
import { BinanceApiError, type SignedParams, signedRequest } from "./signed";
import { DEMO_PUBLIC, DEMO_URL, type TradeVenue } from "./venue.server";
import {
  sumUsd,
  type UsdPrice,
  type WalletEquity,
  type WalletEquityResult,
} from "./walletEquity";

// Функции ордеров и чтения принимают площадку (spec 0049): демо — demoVenue(creds), реальный счёт — liveVenue.
// Имена с «Demo» исторические; адреса и подпись — у площадки (venue.server.ts). Equity демо-счёта (COIN-M) — только демо.
const PREFIX: Record<Market, string> = { spot: "/api/v3", usdm: "/fapi/v1" };
const RULES_TTL_MS = 10 * 60_000;

/**
 * Справочник фьючерсов площадки (~900 КБ) — грузим редко, держим последнюю удачную копию. Свой у каждого адреса:
 * у демо и реального рынка свои символы и шаги.
 */
const futuresRules = new Map<
  string,
  { at: number; bySymbol: Map<string, SymbolRules> }
>();

/** Публичная часть площадки: адреса справочников и цен. По умолчанию — Binance Demo. */
export type PublicVenue = Pick<TradeVenue, "kind" | "publicUrl">;
const DEMO_PUBLIC_VENUE: PublicVenue = { kind: "demo", publicUrl: DEMO_PUBLIC };

const getJson = (url: string, venue: PublicVenue) =>
  getJsonWithRetry(url, venue.kind === "demo" ? "Binance Demo" : "Binance");

/** Binance: -1121 Invalid symbol. */
const isInvalidSymbol = (error: unknown) =>
  error instanceof HttpError &&
  (error.body as { code?: number } | null)?.code === -1121;

function indexRules(market: Market, raw: unknown): Map<string, SymbolRules> {
  const info = exchangeInfoSchema.parse(raw);
  const bySymbol = new Map<string, SymbolRules>();
  for (const s of info.symbols) {
    const rules = s.status === "TRADING" ? toRules(market, s) : null;
    if (rules) bySymbol.set(s.symbol, rules);
  }
  return bySymbol;
}

/**
 * Правила округления символа на площадке (по умолчанию демо); null — символа точно нет на её рынке.
 * Сетевой сбой — исключение NetworkError, а не null.
 */
export async function fetchDemoSymbolRules(
  market: Market,
  symbol: string,
  venue: PublicVenue = DEMO_PUBLIC_VENUE,
): Promise<SymbolRules | null> {
  if (market === "spot") {
    try {
      const raw = await getJson(
        `${venue.publicUrl.spot}${PREFIX.spot}/exchangeInfo?symbol=${symbol}`,
        venue,
      );
      return indexRules("spot", raw).get(symbol) ?? null;
    } catch (error) {
      if (isInvalidSymbol(error)) return null;
      throw error;
    }
  }

  const url = `${venue.publicUrl.usdm}${PREFIX.usdm}/exchangeInfo`;
  let cached = futuresRules.get(url);
  if (!cached || Date.now() - cached.at > RULES_TTL_MS) {
    try {
      const raw = await getJson(url, venue);
      cached = { at: Date.now(), bySymbol: indexRules("usdm", raw) };
      futuresRules.set(url, cached);
    } catch (error) {
      // Устаревший справочник лучше, чем никакого: шаги цены меняются редко.
      if (!cached) throw error;
    }
  }
  return cached.bySymbol.get(symbol) ?? null;
}

export async function fetchDemoPrice(
  market: Market,
  symbol: string,
  venue: PublicVenue = DEMO_PUBLIC_VENUE,
): Promise<number> {
  const raw = await getJson(
    `${venue.publicUrl[market]}${PREFIX[market]}/ticker/price?symbol=${symbol}`,
    venue,
  );
  return priceSchema.parse(raw).price;
}

/** Свободные USDT на демо-споте и демо-фьючерсах. */
export async function fetchDemoUsdtBalances(
  venue: TradeVenue,
): Promise<{ spot: number; usdm: number }> {
  const [spot, futures] = await Promise.all([
    venue.signed("spot", "GET", "/api/v3/account", spotAccountBalancesSchema, {
      omitZeroBalances: true,
    }),
    venue.signed("usdm", "GET", "/fapi/v3/balance", futuresBalancesSchema),
  ]);
  return {
    spot: spot.balances.find((b) => b.asset === "USDT")?.free ?? 0,
    usdm: futures.find((b) => b.asset === "USDT")?.availableBalance ?? 0,
  };
}

const settle = (p: Promise<WalletEquity>): Promise<WalletEquityResult> =>
  p.then(
    (e): WalletEquityResult => ({ ok: true, ...e }),
    (error: unknown): WalletEquityResult => ({ ok: false, error }),
  );

/**
 * Equity демо-счёта в $ по кошелькам, как на demo.binance.com (spec 0038): Spot — free + locked всех активов;
 * USDⓈ-M — walletBalance + unrealizedProfit; COIN-M — balance + crossUnPnl; всё × цена актива в $. Кошельки
 * читаются параллельно и независимо: ошибка одного не мешает остальным. Только чтение.
 */
export async function fetchDemoEquity(
  creds: BinanceCredentials,
  price: UsdPrice,
): Promise<Record<BinanceMarket, WalletEquityResult>> {
  const [spot, usdm, coinm] = await Promise.all([
    settle(
      signedRequest(
        DEMO_URL.spot,
        creds,
        "GET",
        "/api/v3/account",
        spotAccountBalancesSchema,
        { omitZeroBalances: true },
      ).then((a) =>
        sumUsd(
          a.balances.map((b) => ({
            asset: b.asset,
            amount: b.free + b.locked,
          })),
          price,
        ),
      ),
    ),
    settle(
      signedRequest(
        DEMO_URL.futures,
        creds,
        "GET",
        "/fapi/v3/account",
        futuresAccountAssetsSchema,
      ).then((a) =>
        sumUsd(
          a.assets.map((b) => ({
            asset: b.asset,
            amount: b.walletBalance + b.unrealizedProfit,
          })),
          price,
        ),
      ),
    ),
    settle(
      signedRequest(
        DEMO_URL.coinm,
        creds,
        "GET",
        "/dapi/v1/balance",
        coinmBalancesSchema,
      ).then((rows) =>
        sumUsd(
          rows.map((b) => ({
            asset: b.asset,
            amount: b.balance + b.crossUnPnl,
          })),
          price,
        ),
      ),
    ),
  ]);
  return { spot, usdm, coinm };
}

/** clientOrderId — свой id ордера: по нему перечитываем ордер, если исход заявки неизвестен. */
export async function demoSpotMarketOrder(
  venue: TradeVenue,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
  clientOrderId?: string,
): Promise<SpotOrder> {
  return venue.signed("spot", "POST", "/api/v3/order", spotOrderSchema, {
    symbol,
    side,
    type: "MARKET",
    quantity,
    newOrderRespType: "FULL",
    recvWindow: ORDER_RECV_WINDOW_MS,
    ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
  });
}

/** Стоп на продажу (STOP_LOSS — по рынку при касании stopPrice), без тейка. */
export async function demoSpotStopLossSell(
  venue: TradeVenue,
  symbol: string,
  quantity: string,
  stopPrice: string,
  clientOrderId?: string,
): Promise<SpotOrder> {
  return venue.signed("spot", "POST", "/api/v3/order", spotOrderSchema, {
    symbol,
    side: "SELL",
    type: "STOP_LOSS",
    quantity,
    stopPrice,
    newOrderRespType: "RESULT",
    ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
  });
}

/** OCO на продажу: лимитный тейк выше рынка + стоп-маркет ниже. ids — свои clientOrderId. */
export async function demoSpotOcoSell(
  venue: TradeVenue,
  symbol: string,
  quantity: string,
  takeProfit: string,
  stopLoss: string,
  ids?: { list: string; stop: string; takeProfit: string },
) {
  return venue.signed(
    "spot",
    "POST",
    "/api/v3/orderList/oco",
    orderListSchema,
    {
      symbol,
      side: "SELL",
      quantity,
      aboveType: "LIMIT_MAKER",
      abovePrice: takeProfit,
      belowType: "STOP_LOSS",
      belowStopPrice: stopLoss,
      ...(ids
        ? {
            listClientOrderId: ids.list,
            aboveClientOrderId: ids.takeProfit,
            belowClientOrderId: ids.stop,
          }
        : {}),
    },
  );
}

/**
 * Покупка и защита одной составной заявкой (spec 0012): OTOCO (тейк + стоп) или OTO (только стоп).
 * Биржа проверяет все три ордера сразу: стоп за фильтром цены — отказ всей заявки, монеты не куплены.
 */
export async function demoSpotBuyProtected(
  venue: TradeVenue,
  p: SpotEntryListParams,
): Promise<SpotEntryListResult> {
  const { path, params } = spotEntryListRequest(p);
  const res = await venue.signed("spot", "POST", path, orderListReportsSchema, {
    ...params,
    recvWindow: ORDER_RECV_WINDOW_MS,
  });
  return summarizeSpotEntryList(res, p.symbol.replace(/USDT$/, ""));
}

/** Статус ордера спота (NEW, FILLED, EXPIRED…). */
export async function fetchDemoSpotOrderStatus(
  venue: TradeVenue,
  symbol: string,
  orderId: number,
): Promise<string> {
  const order = await venue.signed(
    "spot",
    "GET",
    "/api/v3/order",
    spotOrderStatusSchema,
    { symbol, orderId },
  );
  return order.status;
}

/**
 * Ордер спота по своему clientOrderId; null — такого ордера на бирже нет (-2013 NO_SUCH_ORDER).
 * Нужен, когда исход заявки неизвестен (-1007, 5xx, обрыв сети): дошла ли она до биржи.
 */
export async function fetchDemoSpotOrderByClientId(
  venue: TradeVenue,
  symbol: string,
  clientOrderId: string,
): Promise<SpotOrderQuery | null> {
  try {
    return await venue.signed(
      "spot",
      "GET",
      "/api/v3/order",
      spotOrderQuerySchema,
      { symbol, origClientOrderId: clientOrderId },
    );
  } catch (error) {
    if (error instanceof BinanceApiError && error.code === -2013) return null;
    throw error;
  }
}

/**
 * Отменить свой ордер спота по clientOrderId. Ордер из списка (OCO, OTO/OTOCO) снимает весь
 * список. false — отменять нечего: ордера нет или он уже исполнен/снят (-2011, -2013).
 */
export async function demoSpotCancelByClientId(
  venue: TradeVenue,
  symbol: string,
  clientOrderId: string,
): Promise<boolean> {
  try {
    await venue.signed("spot", "DELETE", "/api/v3/order", anySchema, {
      symbol,
      origClientOrderId: clientOrderId,
    });
    return true;
  } catch (error) {
    if (isNoSuchOrder(error)) return false;
    throw error;
  }
}

/**
 * Изолированная маржа и плечо для символа. «Уже установлено» (-4046) — не ошибка. По символу уже
 * есть ордера/позиция другого зеркала (-4047/-4048, на демо -4067): тип маржи не меняется,
 * вход идёт с тем, что есть — "kept". Плечо меняется и при открытой позиции.
 */
export async function demoFuturesPrepare(
  venue: TradeVenue,
  symbol: string,
  leverage: number,
): Promise<"isolated" | "kept"> {
  let margin: "isolated" | "kept" = "isolated";
  try {
    await venue.signed("usdm", "POST", "/fapi/v1/marginType", anySchema, {
      symbol,
      marginType: "ISOLATED",
    });
  } catch (error) {
    const code = error instanceof BinanceApiError ? error.code : undefined;
    // Демо на marginType при открытых ордерах отвечает -4067 (проверено 2026-10-15), по документации — -4047.
    if (code !== undefined && [-4047, -4048, -4067, -4068].includes(code))
      margin = "kept";
    else if (code !== -4046) throw error;
  }
  await venue.signed("usdm", "POST", "/fapi/v1/leverage", anySchema, {
    symbol,
    leverage,
  });
  return margin;
}

/** Кэш режима позиций: меняется редко (только на пустом счёте), а спрашиваем перед каждым входом. */
const POSITION_MODE_TTL_MS = 30_000;
/** Кэш режима позиций — свой у каждой площадки (демо и реальный счёт на одном процессе не смешиваются). */
const positionModeCaches = new Map<
  string,
  { at: number; mode: PositionMode } | null
>();
const modeKey = (venue: TradeVenue) => `${venue.kind}:${venue.publicUrl.usdm}`;

/** Режим позиций демо-фьючерсов (GET /fapi/v1/positionSide/dual): Hedge или One-way. */
export async function fetchDemoPositionMode(
  venue: TradeVenue,
): Promise<PositionMode> {
  const positionModeCache = positionModeCaches.get(modeKey(venue)) ?? null;
  if (
    positionModeCache &&
    Date.now() - positionModeCache.at < POSITION_MODE_TTL_MS
  )
    return positionModeCache.mode;
  const res = await venue.signed(
    "usdm",
    "GET",
    "/fapi/v1/positionSide/dual",
    positionModeSchema,
  );
  const mode: PositionMode = res.dualSidePosition ? "hedge" : "oneway";
  positionModeCaches.set(modeKey(venue), { at: Date.now(), mode });
  return mode;
}

/**
 * Включить Hedge mode. Биржа переключает только без позиций и ордеров на счёте (-4067/-4068 —
 * исключение, вызывающий остаётся в One-way). Уже включён (-4059) — не ошибка.
 */
export async function demoEnableHedgeMode(
  venue: TradeVenue,
): Promise<"switched" | "already"> {
  try {
    await venue.signed(
      "usdm",
      "POST",
      "/fapi/v1/positionSide/dual",
      anySchema,
      { dualSidePosition: "true" },
    );
    positionModeCaches.set(modeKey(venue), { at: Date.now(), mode: "hedge" });
    return "switched";
  } catch (error) {
    if (error instanceof BinanceApiError && error.code === -4059) {
      positionModeCaches.set(modeKey(venue), { at: Date.now(), mode: "hedge" });
      return "already";
    }
    positionModeCaches.set(modeKey(venue), null);
    throw error;
  }
}

/** Есть ли на демо-фьючерсах хоть одна позиция или открытый ордер (обычный или algo) — по всему счёту. */
export async function fetchDemoFuturesAccountBusy(
  venue: TradeVenue,
): Promise<boolean> {
  const [positions, orders, algos] = await Promise.all([
    venue.signed("usdm", "GET", "/fapi/v3/positionRisk", positionRiskSchema),
    venue.signed("usdm", "GET", "/fapi/v1/openOrders", symbolRowsSchema),
    venue.signed("usdm", "GET", "/fapi/v1/openAlgoOrders", symbolRowsSchema),
  ]);
  return (
    positions.some((p) => p.positionAmt !== 0) ||
    orders.length > 0 ||
    algos.length > 0
  );
}

/** Позиции, открытые обычные и algo-ордера символа — для проверки своей стороны и закрытия старых строк. */
export async function fetchDemoFuturesSymbolState(
  venue: TradeVenue,
  symbol: string,
): Promise<FuturesSymbolState> {
  const [positions, orders, algos] = await Promise.all([
    venue.signed("usdm", "GET", "/fapi/v3/positionRisk", positionRiskSchema, {
      symbol,
    }),
    venue.signed(
      "usdm",
      "GET",
      "/fapi/v1/openOrders",
      futuresOpenOrdersSchema,
      { symbol },
    ),
    venue.signed(
      "usdm",
      "GET",
      "/fapi/v1/openAlgoOrders",
      futuresOpenAlgoOrdersSchema,
      { symbol },
    ),
  ]);
  return {
    positions: positions.map((p) => ({
      positionSide: p.positionSide,
      amount: p.positionAmt,
      entryPrice: p.entryPrice,
    })),
    orders,
    algos,
  };
}

/**
 * Открытые algo-ордера (TP/SL) всего фьючерсного счёта одним запросом — для сверки своих ног
 * зеркал за прогон (spec 0012, PR 2d).
 */
export async function fetchDemoOpenAlgoOrders(
  venue: TradeVenue,
): Promise<FuturesSymbolState["algos"]> {
  return venue.signed(
    "usdm",
    "GET",
    "/fapi/v1/openAlgoOrders",
    futuresOpenAlgoOrdersSchema,
  );
}

/** Отменить обычный ордер фьючерсов. false — отменять нечего (-2011). */
export async function demoFuturesCancelOrder(
  venue: TradeVenue,
  symbol: string,
  orderId: number,
): Promise<boolean> {
  try {
    await venue.signed("usdm", "DELETE", "/fapi/v1/order", anySchema, {
      symbol,
      orderId,
    });
    return true;
  } catch (error) {
    if (isNoSuchOrder(error)) return false;
    throw error;
  }
}

/** Вход по рынку. clientOrderId — свой id: по нему перечитываем вход, если исход неизвестен. */
export async function demoFuturesMarketOrder(
  venue: TradeVenue,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
  clientOrderId: string | undefined,
  pos: FuturesSide,
): Promise<FuturesOrder> {
  return venue.signed("usdm", "POST", "/fapi/v1/order", futuresOrderSchema, {
    symbol,
    side,
    type: "MARKET",
    quantity,
    newOrderRespType: "RESULT",
    recvWindow: ORDER_RECV_WINDOW_MS,
    ...entryParams(pos),
    ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
  });
}

/**
 * Ордер фьючерсов по orderId или своему clientOrderId; null — такого ордера нет (-2013).
 * Нужен для фактической цены входа (в ответе MARKET avgPrice бывает 0) и сверки неизвестного исхода.
 */
export async function fetchDemoFuturesOrder(
  venue: TradeVenue,
  symbol: string,
  ref: { orderId: number } | { clientOrderId: string },
): Promise<FuturesOrder | null> {
  try {
    return await venue.signed(
      "usdm",
      "GET",
      "/fapi/v1/order",
      futuresOrderSchema,
      "orderId" in ref
        ? { symbol, orderId: ref.orderId }
        : { symbol, origClientOrderId: ref.clientOrderId },
    );
  } catch (error) {
    if (isNoSuchOrder(error)) return null;
    throw error;
  }
}

/**
 * Условный ордер (TP или SL) на свой объём при достижении цены (spec 0012, PR 2c): quantity, без
 * closePosition — сработавший не закроет объём других зеркал. One-way — reduceOnly, Hedge — positionSide.
 */
export async function demoFuturesProtect(
  venue: TradeVenue,
  symbol: string,
  side: "BUY" | "SELL",
  type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
  triggerPrice: string,
  quantity: string,
  pos: FuturesSide,
  clientAlgoId?: string,
) {
  return venue.signed("usdm", "POST", "/fapi/v1/algoOrder", algoOrderSchema, {
    algoType: "CONDITIONAL",
    symbol,
    side,
    type,
    triggerPrice,
    ...protectParams(pos, quantity),
    workingType: "MARK_PRICE",
    priceProtect: true,
    // Короткое окно — дедлайн перечитывания при неизвестном исходе (как у входа).
    recvWindow: ORDER_RECV_WINDOW_MS,
    ...(clientAlgoId ? { clientAlgoId } : {}),
  });
}

/** Свой algo-ордер: по algoId, а если его нет (исход постановки был неизвестен) — по clientAlgoId. */
export type AlgoRef = { algoId: number } | { clientAlgoId: string };

const algoParams = (ref: AlgoRef): SignedParams =>
  "algoId" in ref ? { algoId: ref.algoId } : { clientAlgoId: ref.clientAlgoId };

/** Свой algo-ордер (стоп/тейк); null — не найден (снятые без исполнения хранятся 3 дня). */
export async function fetchDemoAlgoOrder(
  venue: TradeVenue,
  ref: AlgoRef,
): Promise<AlgoOrderQuery | null> {
  try {
    return await venue.signed(
      "usdm",
      "GET",
      "/fapi/v1/algoOrder",
      algoOrderQuerySchema,
      algoParams(ref),
    );
  } catch (error) {
    if (isNoSuchOrder(error)) return null;
    throw error;
  }
}

/** Отменить свой algo-ордер. false — отменять нечего (уже сработал, снят или не найден). */
export async function demoCancelAlgoOrder(
  venue: TradeVenue,
  ref: AlgoRef,
): Promise<boolean> {
  try {
    await venue.signed(
      "usdm",
      "DELETE",
      "/fapi/v1/algoOrder",
      anySchema,
      algoParams(ref),
    );
    return true;
  } catch (error) {
    if (isNoSuchOrder(error)) return false;
    throw error;
  }
}

/**
 * Закрытие (части) своей позиции по рынку: One-way — reduceOnly (не откроет встречную), Hedge —
 * positionSide своей стороны.
 */
export async function demoFuturesReduceMarket(
  venue: TradeVenue,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
  pos: FuturesSide,
  clientOrderId?: string,
): Promise<FuturesOrder> {
  return venue.signed("usdm", "POST", "/fapi/v1/order", futuresOrderSchema, {
    symbol,
    side,
    type: "MARKET",
    quantity,
    ...reduceParams(pos),
    newOrderRespType: "RESULT",
    // Свой id закрытия — сделка в истории «Демо-сделки» не смешается с соседними по монете.
    ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
  });
}

/** Binance: -2011 (отмена: ордер неизвестен/уже не активен), -2013 (запрос: ордера нет). */
const isNoSuchOrder = (error: unknown) =>
  error instanceof BinanceApiError &&
  (error.code === -2011 || error.code === -2013);

/** Открытые ордера спота по символу — для закрытия старых строк (снимаются только свои стороны). */
export async function fetchDemoSpotOpenOrders(
  venue: TradeVenue,
  symbol: string,
): Promise<SpotOpenOrder[]> {
  return venue.signed(
    "spot",
    "GET",
    "/api/v3/openOrders",
    spotOpenOrdersSchema,
    {
      symbol,
    },
  );
}

/** Отменить ордер спота по orderId (ордер из списка снимает весь список). false — отменять нечего. */
export async function demoSpotCancelOrder(
  venue: TradeVenue,
  symbol: string,
  orderId: number,
): Promise<boolean> {
  try {
    await venue.signed("spot", "DELETE", "/api/v3/order", anySchema, {
      symbol,
      orderId,
    });
    return true;
  } catch (error) {
    if (isNoSuchOrder(error)) return false;
    throw error;
  }
}

/**
 * Позиции символа на демо-фьючерсах по сторонам: One-way — одна строка BOTH (размер со знаком,
 * минус — шорт), Hedge — LONG и SHORT отдельно. Своя сторона — lib/futuresMode → ownPosition.
 */
export async function demoFuturesPositions(
  venue: TradeVenue,
  symbol: string,
): Promise<FuturesSymbolState["positions"]> {
  const rows = await venue.signed(
    "usdm",
    "GET",
    "/fapi/v3/positionRisk",
    positionRiskSchema,
    { symbol },
  );
  return rows.map((r) => ({
    positionSide: r.positionSide,
    amount: r.positionAmt,
    entryPrice: r.entryPrice,
  }));
}

/** Одно исполнение (fill) ордера на демо-счёте. */
export interface DemoFill {
  market: Market;
  symbol: string;
  orderId: number;
  /** Unix ms. */
  time: number;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  /** Только фьючерсы: зафиксированный PnL исполнения. */
  realizedPnl: number | null;
  /** Сторона позиции: Hedge — LONG/SHORT, One-way и спот — BOTH. */
  positionSide: string;
}

const symbolsOf = (rows: { symbol: string }[]) =>
  rows.map((r) => r.symbol).filter(Boolean);

/** Символы с возможной историей сделок + текущие позиции и баланс (нужны и для статусов). */
export interface DemoTradeSnapshot {
  symbols: Record<Market, string[]>;
  /** Открытые позиции демо-фьючерсов по символам. */
  positions: Map<string, DemoPosition>;
  /** Монеты на демо-споте: актив → free + locked. */
  holdings: Map<string, number>;
}

/**
 * Символы, по которым на демо-счёте могли быть сделки. История сделок Binance
 * требует symbol, поэтому собираем их из запросов без символа. Spot: OCO-история
 * (каждая spot-сделка из дашборда ставит OCO), открытые ордера, монеты на балансе.
 * Futures: income-история (комиссии и PnL), позиции, открытые и algo-ордера.
 */
export async function fetchDemoTradedSymbols(
  venue: TradeVenue,
): Promise<DemoTradeSnapshot> {
  const spot = (path: string, params = {}) =>
    venue.signed("spot", "GET", path, symbolRowsSchema, params);
  const futures = (path: string, params = {}) =>
    venue.signed("usdm", "GET", path, symbolRowsSchema, params);
  const [orderLists, spotOpen, holdings, income, positions, futOpen, algoOpen] =
    await Promise.all([
      spot("/api/v3/allOrderList", { limit: 1000 }),
      spot("/api/v3/openOrders"),
      fetchDemoSpotHoldings(venue),
      futures("/fapi/v1/income", { limit: 1000 }),
      fetchDemoFuturesPositions(venue),
      futures("/fapi/v1/openOrders"),
      futures("/fapi/v1/openAlgoOrders"),
    ]);
  const held = [...holdings]
    .filter(([asset, amount]) => amount > 0 && !isStablecoin(asset))
    .map(([asset]) => `${asset}USDT`);
  return {
    symbols: {
      spot: [
        ...new Set([...symbolsOf(orderLists), ...symbolsOf(spotOpen), ...held]),
      ],
      usdm: [
        ...new Set([
          ...symbolsOf(income),
          ...positions.keys(),
          ...symbolsOf(futOpen),
          ...symbolsOf(algoOpen),
        ]),
      ],
    },
    positions,
    holdings,
  };
}

/**
 * Символы, по которым сделка ещё «живая»: открыта позиция или висят ордера (TP/SL, OCO).
 * С `symbol` проверяет только его (фьючерсы) — так дешевле по весу запросов.
 */
export async function fetchDemoOpenSymbols(
  venue: TradeVenue,
  symbol?: string,
): Promise<Record<Market, string[]>> {
  const params: Record<string, string> = symbol ? { symbol } : {};
  const futures = (path: string) =>
    venue.signed("usdm", "GET", path, symbolRowsSchema, params);
  const [spotOpen, positions, futOpen, algoOpen] = await Promise.all([
    symbol
      ? []
      : venue.signed("spot", "GET", "/api/v3/openOrders", symbolRowsSchema),
    venue.signed(
      "usdm",
      "GET",
      "/fapi/v3/positionRisk",
      positionRiskSchema,
      params,
    ),
    futures("/fapi/v1/openOrders"),
    futures("/fapi/v1/openAlgoOrders"),
  ]);
  return {
    spot: [...new Set(symbolsOf(spotOpen))],
    usdm: [
      ...new Set([
        ...symbolsOf(positions.filter((p) => p.positionAmt !== 0)),
        ...symbolsOf(futOpen),
        ...symbolsOf(algoOpen),
      ]),
    ],
  };
}

/** Последние исполнения по символу (Binance отдаёт старые сверху). Нет пары — пусто. */
export async function fetchDemoFills(
  venue: TradeVenue,
  market: Market,
  symbol: string,
  limit = 100,
): Promise<DemoFill[]> {
  try {
    if (market === "spot") {
      const rows = await venue.signed(
        "spot",
        "GET",
        "/api/v3/myTrades",
        spotMyTradesSchema,
        { symbol, limit },
      );
      return rows.map((r) => ({
        market,
        symbol: r.symbol,
        orderId: r.orderId,
        time: r.time,
        side: r.isBuyer ? "BUY" : "SELL",
        price: r.price,
        qty: r.qty,
        quoteQty: r.quoteQty,
        commission: r.commission,
        commissionAsset: r.commissionAsset,
        realizedPnl: null,
        positionSide: "BOTH",
      }));
    }
    const rows = await venue.signed(
      "usdm",
      "GET",
      "/fapi/v1/userTrades",
      futuresUserTradesSchema,
      { symbol, limit },
    );
    return rows.map((r) => ({
      market,
      symbol: r.symbol,
      orderId: r.orderId,
      time: r.time,
      side: r.side,
      price: r.price,
      qty: r.qty,
      quoteQty: r.quoteQty,
      commission: r.commission,
      commissionAsset: r.commissionAsset,
      realizedPnl: r.realizedPnl,
      positionSide: r.positionSide,
    }));
  } catch (error) {
    // -1121 Invalid symbol: монета на балансе без пары к USDT.
    if (error instanceof BinanceApiError && error.code === -1121) return [];
    throw error;
  }
}

/**
 * История ордеров символа для статусов сделок (маппинг — `demoOrders.ts`).
 * Символа нет на демо — пустой результат.
 */
export async function fetchDemoSymbolOrders(
  venue: TradeVenue,
  market: Market,
  symbol: string,
): Promise<DemoSymbolOrders> {
  try {
    if (market === "spot")
      return toSpotSymbolOrders(
        await venue.signed(
          "spot",
          "GET",
          "/api/v3/allOrders",
          spotAllOrdersSchema,
          { symbol, limit: 500 },
        ),
      );
    const [algos, orders] = await Promise.all([
      venue.signed("usdm", "GET", "/fapi/v1/allAlgoOrders", algoHistorySchema, {
        symbol,
      }),
      venue.signed(
        "usdm",
        "GET",
        "/fapi/v1/allOrders",
        futuresAllOrdersSchema,
        { symbol, limit: 500 },
      ),
    ]);
    return toFuturesSymbolOrders(algos, orders);
  } catch (error) {
    if (error instanceof BinanceApiError && error.code === -1121)
      return {
        closeKinds: new Map(),
        openStops: [],
        groups: new Map(),
        fullExits: new Set(),
      };
    throw error;
  }
}

export interface DemoPosition {
  /** Размер со знаком: минус — шорт (в Hedge — сумма сторон). */
  amount: number;
  entryPrice: number;
  unrealizedPnl: number;
  /** Размер по сторонам (positionSide → размер со знаком): Hedge — LONG/SHORT, One-way — BOTH. */
  bySide: Record<string, number>;
}

/** Открытые позиции демо-фьючерсов по символам. */
export async function fetchDemoFuturesPositions(
  venue: TradeVenue,
): Promise<Map<string, DemoPosition>> {
  const rows = await venue.signed(
    "usdm",
    "GET",
    "/fapi/v3/positionRisk",
    positionRiskSchema,
  );
  const bySymbol = new Map<string, DemoPosition>();
  for (const r of rows) {
    if (r.positionAmt === 0) continue;
    const prev = bySymbol.get(r.symbol);
    bySymbol.set(r.symbol, {
      amount: (prev?.amount ?? 0) + r.positionAmt,
      entryPrice: r.entryPrice,
      unrealizedPnl: (prev?.unrealizedPnl ?? 0) + r.unRealizedProfit,
      bySide: { ...prev?.bySide, [r.positionSide]: r.positionAmt },
    });
  }
  return bySymbol;
}

/** Монеты на демо-споте: актив → free + locked. */
export async function fetchDemoSpotHoldings(
  venue: TradeVenue,
): Promise<Map<string, number>> {
  const account = await venue.signed(
    "spot",
    "GET",
    "/api/v3/account",
    spotAccountBalancesSchema,
    { omitZeroBalances: true },
  );
  return new Map(account.balances.map((b) => [b.asset, b.free + b.locked]));
}
