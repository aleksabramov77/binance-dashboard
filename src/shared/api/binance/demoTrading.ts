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
  exchangeInfoSchema,
  type FuturesOrder,
  type FuturesSymbolState,
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
import { ORDER_RECV_WINDOW_MS } from "./orderOutcome";
import {
  entryParams,
  type FuturesSide,
  type PositionMode,
  protectParams,
  reduceParams,
} from "./positionMode";
import { BinanceApiError, type SignedParams, signedRequest } from "./signed";

/** Binance Demo Trading — виртуальные деньги, реальные котировки. Хосты: spot и фьючерсы USDⓈ-M. */
const DEMO_URL = {
  spot: "https://demo-api.binance.com",
  futures: "https://demo-fapi.binance.com",
} as const;
const DEMO_HOST: Record<Market, string> = {
  spot: DEMO_URL.spot,
  usdm: DEMO_URL.futures,
};
const PREFIX: Record<Market, string> = { spot: "/api/v3", usdm: "/fapi/v1" };
const RULES_TTL_MS = 10 * 60_000;

/** Справочник демо-фьючерсов (~900 КБ) — грузим редко, держим последнюю удачную копию. */
let futuresRules: { at: number; bySymbol: Map<string, SymbolRules> } | null =
  null;

const getJson = (url: string) => getJsonWithRetry(url, "Binance Demo");

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
 * Правила округления символа на демо; null — символа точно нет в Demo Trading.
 * Сетевой сбой — исключение NetworkError, а не null.
 */
export async function fetchDemoSymbolRules(
  market: Market,
  symbol: string,
): Promise<SymbolRules | null> {
  if (market === "spot") {
    try {
      const raw = await getJson(
        `${DEMO_URL.spot}${PREFIX.spot}/exchangeInfo?symbol=${symbol}`,
      );
      return indexRules("spot", raw).get(symbol) ?? null;
    } catch (error) {
      if (isInvalidSymbol(error)) return null;
      throw error;
    }
  }

  if (!futuresRules || Date.now() - futuresRules.at > RULES_TTL_MS) {
    try {
      const raw = await getJson(
        `${DEMO_URL.futures}${PREFIX.usdm}/exchangeInfo`,
      );
      futuresRules = {
        at: Date.now(),
        bySymbol: indexRules("usdm", raw),
      };
    } catch (error) {
      // Устаревший справочник лучше, чем никакого: шаги цены меняются редко.
      if (!futuresRules) throw error;
    }
  }
  return futuresRules?.bySymbol.get(symbol) ?? null;
}

export async function fetchDemoPrice(
  market: Market,
  symbol: string,
): Promise<number> {
  const raw = await getJson(
    `${DEMO_HOST[market]}${PREFIX[market]}/ticker/price?symbol=${symbol}`,
  );
  return priceSchema.parse(raw).price;
}

/** Свободные USDT на демо-споте и демо-фьючерсах. */
export async function fetchDemoUsdtBalances(
  creds: BinanceCredentials,
): Promise<{ spot: number; usdm: number }> {
  const [spot, futures] = await Promise.all([
    signedRequest(
      DEMO_URL.spot,
      creds,
      "GET",
      "/api/v3/account",
      spotAccountBalancesSchema,
      { omitZeroBalances: true },
    ),
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      "/fapi/v3/balance",
      futuresBalancesSchema,
    ),
  ]);
  return {
    spot: spot.balances.find((b) => b.asset === "USDT")?.free ?? 0,
    usdm: futures.find((b) => b.asset === "USDT")?.availableBalance ?? 0,
  };
}

/** clientOrderId — свой id ордера: по нему перечитываем ордер, если исход заявки неизвестен. */
export async function demoSpotMarketOrder(
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
  clientOrderId?: string,
): Promise<SpotOrder> {
  return signedRequest(
    DEMO_URL.spot,
    creds,
    "POST",
    "/api/v3/order",
    spotOrderSchema,
    {
      symbol,
      side,
      type: "MARKET",
      quantity,
      newOrderRespType: "FULL",
      recvWindow: ORDER_RECV_WINDOW_MS,
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
    },
  );
}

/** Стоп на продажу (STOP_LOSS — по рынку при касании stopPrice), без тейка. */
export async function demoSpotStopLossSell(
  creds: BinanceCredentials,
  symbol: string,
  quantity: string,
  stopPrice: string,
  clientOrderId?: string,
): Promise<SpotOrder> {
  return signedRequest(
    DEMO_URL.spot,
    creds,
    "POST",
    "/api/v3/order",
    spotOrderSchema,
    {
      symbol,
      side: "SELL",
      type: "STOP_LOSS",
      quantity,
      stopPrice,
      newOrderRespType: "RESULT",
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
    },
  );
}

/** OCO на продажу: лимитный тейк выше рынка + стоп-маркет ниже. ids — свои clientOrderId. */
export async function demoSpotOcoSell(
  creds: BinanceCredentials,
  symbol: string,
  quantity: string,
  takeProfit: string,
  stopLoss: string,
  ids?: { list: string; stop: string; takeProfit: string },
) {
  return signedRequest(
    DEMO_URL.spot,
    creds,
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
  creds: BinanceCredentials,
  p: SpotEntryListParams,
): Promise<SpotEntryListResult> {
  const { path, params } = spotEntryListRequest(p);
  const res = await signedRequest(
    DEMO_URL.spot,
    creds,
    "POST",
    path,
    orderListReportsSchema,
    { ...params, recvWindow: ORDER_RECV_WINDOW_MS },
  );
  return summarizeSpotEntryList(res, p.symbol.replace(/USDT$/, ""));
}

/** Статус ордера спота (NEW, FILLED, EXPIRED…). */
export async function fetchDemoSpotOrderStatus(
  creds: BinanceCredentials,
  symbol: string,
  orderId: number,
): Promise<string> {
  const order = await signedRequest(
    DEMO_URL.spot,
    creds,
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
  creds: BinanceCredentials,
  symbol: string,
  clientOrderId: string,
): Promise<SpotOrderQuery | null> {
  try {
    return await signedRequest(
      DEMO_URL.spot,
      creds,
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
  creds: BinanceCredentials,
  symbol: string,
  clientOrderId: string,
): Promise<boolean> {
  try {
    await signedRequest(
      DEMO_URL.spot,
      creds,
      "DELETE",
      "/api/v3/order",
      anySchema,
      {
        symbol,
        origClientOrderId: clientOrderId,
      },
    );
    return true;
  } catch (error) {
    if (isNoSuchOrder(error)) return false;
    throw error;
  }
}

/**
 * Изолированная маржа и плечо для символа. «Уже установлено» (-4046) — не ошибка. По символу уже
 * есть ордера/позиция другого зеркала (-4047/-4048 — в Hedge это нормально): тип маржи не меняется,
 * вход идёт с тем, что есть — "kept". Плечо меняется и при открытой позиции.
 */
export async function demoFuturesPrepare(
  creds: BinanceCredentials,
  symbol: string,
  leverage: number,
): Promise<"isolated" | "kept"> {
  let margin: "isolated" | "kept" = "isolated";
  try {
    await signedRequest(
      DEMO_URL.futures,
      creds,
      "POST",
      "/fapi/v1/marginType",
      anySchema,
      { symbol, marginType: "ISOLATED" },
    );
  } catch (error) {
    const code = error instanceof BinanceApiError ? error.code : undefined;
    if (code === -4047 || code === -4048) margin = "kept";
    else if (code !== -4046) throw error;
  }
  await signedRequest(
    DEMO_URL.futures,
    creds,
    "POST",
    "/fapi/v1/leverage",
    anySchema,
    { symbol, leverage },
  );
  return margin;
}

/** Кэш режима позиций: меняется редко (только на пустом счёте), а спрашиваем перед каждым входом. */
const POSITION_MODE_TTL_MS = 30_000;
let positionModeCache: { at: number; mode: PositionMode } | null = null;

/** Режим позиций демо-фьючерсов (GET /fapi/v1/positionSide/dual): Hedge или One-way. */
export async function fetchDemoPositionMode(
  creds: BinanceCredentials,
): Promise<PositionMode> {
  if (
    positionModeCache &&
    Date.now() - positionModeCache.at < POSITION_MODE_TTL_MS
  )
    return positionModeCache.mode;
  const res = await signedRequest(
    DEMO_URL.futures,
    creds,
    "GET",
    "/fapi/v1/positionSide/dual",
    positionModeSchema,
  );
  const mode: PositionMode = res.dualSidePosition ? "hedge" : "oneway";
  positionModeCache = { at: Date.now(), mode };
  return mode;
}

/**
 * Включить Hedge mode. Биржа переключает только без позиций и ордеров на счёте (-4067/-4068 —
 * исключение, вызывающий остаётся в One-way). Уже включён (-4059) — не ошибка.
 */
export async function demoEnableHedgeMode(
  creds: BinanceCredentials,
): Promise<"switched" | "already"> {
  try {
    await signedRequest(
      DEMO_URL.futures,
      creds,
      "POST",
      "/fapi/v1/positionSide/dual",
      anySchema,
      { dualSidePosition: "true" },
    );
    positionModeCache = { at: Date.now(), mode: "hedge" };
    return "switched";
  } catch (error) {
    if (error instanceof BinanceApiError && error.code === -4059) {
      positionModeCache = { at: Date.now(), mode: "hedge" };
      return "already";
    }
    positionModeCache = null;
    throw error;
  }
}

/** Есть ли на демо-фьючерсах хоть одна позиция или открытый ордер (обычный или algo) — по всему счёту. */
export async function fetchDemoFuturesAccountBusy(
  creds: BinanceCredentials,
): Promise<boolean> {
  const [positions, orders, algos] = await Promise.all([
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      "/fapi/v3/positionRisk",
      positionRiskSchema,
    ),
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      "/fapi/v1/openOrders",
      symbolRowsSchema,
    ),
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      "/fapi/v1/openAlgoOrders",
      symbolRowsSchema,
    ),
  ]);
  return (
    positions.some((p) => p.positionAmt !== 0) ||
    orders.length > 0 ||
    algos.length > 0
  );
}

/** Позиции, открытые обычные и algo-ордера символа — для проверки своей стороны и закрытия старых строк. */
export async function fetchDemoFuturesSymbolState(
  creds: BinanceCredentials,
  symbol: string,
): Promise<FuturesSymbolState> {
  const [positions, orders, algos] = await Promise.all([
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      "/fapi/v3/positionRisk",
      positionRiskSchema,
      { symbol },
    ),
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      "/fapi/v1/openOrders",
      futuresOpenOrdersSchema,
      { symbol },
    ),
    signedRequest(
      DEMO_URL.futures,
      creds,
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

/** Отменить обычный ордер фьючерсов. false — отменять нечего (-2011). */
export async function demoFuturesCancelOrder(
  creds: BinanceCredentials,
  symbol: string,
  orderId: number,
): Promise<boolean> {
  try {
    await signedRequest(
      DEMO_URL.futures,
      creds,
      "DELETE",
      "/fapi/v1/order",
      anySchema,
      {
        symbol,
        orderId,
      },
    );
    return true;
  } catch (error) {
    if (isNoSuchOrder(error)) return false;
    throw error;
  }
}

/** Вход по рынку. clientOrderId — свой id: по нему перечитываем вход, если исход неизвестен. */
export async function demoFuturesMarketOrder(
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
  clientOrderId: string | undefined,
  pos: FuturesSide,
): Promise<FuturesOrder> {
  return signedRequest(
    DEMO_URL.futures,
    creds,
    "POST",
    "/fapi/v1/order",
    futuresOrderSchema,
    {
      symbol,
      side,
      type: "MARKET",
      quantity,
      newOrderRespType: "RESULT",
      recvWindow: ORDER_RECV_WINDOW_MS,
      ...entryParams(pos),
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
    },
  );
}

/**
 * Ордер фьючерсов по orderId или своему clientOrderId; null — такого ордера нет (-2013).
 * Нужен для фактической цены входа (в ответе MARKET avgPrice бывает 0) и сверки неизвестного исхода.
 */
export async function fetchDemoFuturesOrder(
  creds: BinanceCredentials,
  symbol: string,
  ref: { orderId: number } | { clientOrderId: string },
): Promise<FuturesOrder | null> {
  try {
    return await signedRequest(
      DEMO_URL.futures,
      creds,
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
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
  triggerPrice: string,
  quantity: string,
  pos: FuturesSide,
  clientAlgoId?: string,
) {
  return signedRequest(
    DEMO_URL.futures,
    creds,
    "POST",
    "/fapi/v1/algoOrder",
    algoOrderSchema,
    {
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
    },
  );
}

/** Свой algo-ордер: по algoId, а если его нет (исход постановки был неизвестен) — по clientAlgoId. */
export type AlgoRef = { algoId: number } | { clientAlgoId: string };

const algoParams = (ref: AlgoRef): SignedParams =>
  "algoId" in ref ? { algoId: ref.algoId } : { clientAlgoId: ref.clientAlgoId };

/** Свой algo-ордер (стоп/тейк); null — не найден (снятые без исполнения хранятся 3 дня). */
export async function fetchDemoAlgoOrder(
  creds: BinanceCredentials,
  ref: AlgoRef,
): Promise<AlgoOrderQuery | null> {
  try {
    return await signedRequest(
      DEMO_URL.futures,
      creds,
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
  creds: BinanceCredentials,
  ref: AlgoRef,
): Promise<boolean> {
  try {
    await signedRequest(
      DEMO_URL.futures,
      creds,
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
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
  pos: FuturesSide,
): Promise<FuturesOrder> {
  return signedRequest(
    DEMO_URL.futures,
    creds,
    "POST",
    "/fapi/v1/order",
    futuresOrderSchema,
    {
      symbol,
      side,
      type: "MARKET",
      quantity,
      ...reduceParams(pos),
      newOrderRespType: "RESULT",
    },
  );
}

/** Binance: -2011 (отмена: ордер неизвестен/уже не активен), -2013 (запрос: ордера нет). */
const isNoSuchOrder = (error: unknown) =>
  error instanceof BinanceApiError &&
  (error.code === -2011 || error.code === -2013);

/** Открытые ордера спота по символу — для закрытия старых строк (снимаются только свои стороны). */
export async function fetchDemoSpotOpenOrders(
  creds: BinanceCredentials,
  symbol: string,
): Promise<SpotOpenOrder[]> {
  return signedRequest(
    DEMO_URL.spot,
    creds,
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
  creds: BinanceCredentials,
  symbol: string,
  orderId: number,
): Promise<boolean> {
  try {
    await signedRequest(
      DEMO_URL.spot,
      creds,
      "DELETE",
      "/api/v3/order",
      anySchema,
      {
        symbol,
        orderId,
      },
    );
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
  creds: BinanceCredentials,
  symbol: string,
): Promise<FuturesSymbolState["positions"]> {
  const rows = await signedRequest(
    DEMO_URL.futures,
    creds,
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
  creds: BinanceCredentials,
): Promise<DemoTradeSnapshot> {
  const spot = (path: string, params = {}) =>
    signedRequest(DEMO_URL.spot, creds, "GET", path, symbolRowsSchema, params);
  const futures = (path: string, params = {}) =>
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      path,
      symbolRowsSchema,
      params,
    );
  const [orderLists, spotOpen, holdings, income, positions, futOpen, algoOpen] =
    await Promise.all([
      spot("/api/v3/allOrderList", { limit: 1000 }),
      spot("/api/v3/openOrders"),
      fetchDemoSpotHoldings(creds),
      futures("/fapi/v1/income", { limit: 1000 }),
      fetchDemoFuturesPositions(creds),
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
  creds: BinanceCredentials,
  symbol?: string,
): Promise<Record<Market, string[]>> {
  const params: Record<string, string> = symbol ? { symbol } : {};
  const futures = (path: string) =>
    signedRequest(
      DEMO_URL.futures,
      creds,
      "GET",
      path,
      symbolRowsSchema,
      params,
    );
  const [spotOpen, positions, futOpen, algoOpen] = await Promise.all([
    symbol
      ? []
      : signedRequest(
          DEMO_URL.spot,
          creds,
          "GET",
          "/api/v3/openOrders",
          symbolRowsSchema,
        ),
    signedRequest(
      DEMO_URL.futures,
      creds,
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
  creds: BinanceCredentials,
  market: Market,
  symbol: string,
  limit = 100,
): Promise<DemoFill[]> {
  try {
    if (market === "spot") {
      const rows = await signedRequest(
        DEMO_URL.spot,
        creds,
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
      }));
    }
    const rows = await signedRequest(
      DEMO_URL.futures,
      creds,
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
  creds: BinanceCredentials,
  market: Market,
  symbol: string,
): Promise<DemoSymbolOrders> {
  try {
    if (market === "spot")
      return toSpotSymbolOrders(
        await signedRequest(
          DEMO_URL.spot,
          creds,
          "GET",
          "/api/v3/allOrders",
          spotAllOrdersSchema,
          { symbol, limit: 500 },
        ),
      );
    const [algos, orders] = await Promise.all([
      signedRequest(
        DEMO_URL.futures,
        creds,
        "GET",
        "/fapi/v1/allAlgoOrders",
        algoHistorySchema,
        { symbol },
      ),
      signedRequest(
        DEMO_URL.futures,
        creds,
        "GET",
        "/fapi/v1/allOrders",
        futuresAllOrdersSchema,
        { symbol, limit: 500 },
      ),
    ]);
    return toFuturesSymbolOrders(algos, orders);
  } catch (error) {
    if (error instanceof BinanceApiError && error.code === -1121)
      return { closeKinds: new Map(), openStops: [] };
    throw error;
  }
}

export interface DemoPosition {
  /** Размер со знаком: минус — шорт. */
  amount: number;
  entryPrice: number;
  unrealizedPnl: number;
}

/** Открытые позиции демо-фьючерсов по символам. */
export async function fetchDemoFuturesPositions(
  creds: BinanceCredentials,
): Promise<Map<string, DemoPosition>> {
  const rows = await signedRequest(
    DEMO_URL.futures,
    creds,
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
    });
  }
  return bySymbol;
}

/** Монеты на демо-споте: актив → free + locked. */
export async function fetchDemoSpotHoldings(
  creds: BinanceCredentials,
): Promise<Map<string, number>> {
  const account = await signedRequest(
    DEMO_URL.spot,
    creds,
    "GET",
    "/api/v3/account",
    spotAccountBalancesSchema,
    { omitZeroBalances: true },
  );
  return new Map(account.balances.map((b) => [b.asset, b.free + b.locked]));
}
