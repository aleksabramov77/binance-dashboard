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
  algoHistorySchema,
  algoOrderSchema,
  anySchema,
  exchangeInfoSchema,
  type FuturesOrder,
  futuresAllOrdersSchema,
  futuresBalancesSchema,
  futuresOrderSchema,
  futuresUserTradesSchema,
  orderListReportsSchema,
  orderListSchema,
  positionRiskSchema,
  priceSchema,
  type SpotOrder,
  spotAccountBalancesSchema,
  spotAllOrdersSchema,
  spotMyTradesSchema,
  spotOrderSchema,
  spotOrderStatusSchema,
  symbolRowsSchema,
} from "./demoSchemas";
import type { Market } from "./market";
import { BinanceApiError, signedRequest } from "./signed";

/** Binance Demo Trading — виртуальные деньги, реальные котировки. */
const DEMO_URL: Record<Market, string> = {
  spot: "https://demo-api.binance.com",
  futures: "https://demo-fapi.binance.com",
};
const PREFIX: Record<Market, string> = { spot: "/api/v3", futures: "/fapi/v1" };
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
        `${DEMO_URL.futures}${PREFIX.futures}/exchangeInfo`,
      );
      futuresRules = {
        at: Date.now(),
        bySymbol: indexRules("futures", raw),
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
    `${DEMO_URL[market]}${PREFIX[market]}/ticker/price?symbol=${symbol}`,
  );
  return priceSchema.parse(raw).price;
}

/** Свободные USDT на демо-споте и демо-фьючерсах. */
export async function fetchDemoUsdtBalances(
  creds: BinanceCredentials,
): Promise<{ spot: number; futures: number }> {
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
    futures: futures.find((b) => b.asset === "USDT")?.availableBalance ?? 0,
  };
}

export async function demoSpotMarketOrder(
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
): Promise<SpotOrder> {
  return signedRequest(
    DEMO_URL.spot,
    creds,
    "POST",
    "/api/v3/order",
    spotOrderSchema,
    { symbol, side, type: "MARKET", quantity, newOrderRespType: "FULL" },
  );
}

/** Стоп на продажу (STOP_LOSS — по рынку при касании stopPrice), без тейка. */
export async function demoSpotStopLossSell(
  creds: BinanceCredentials,
  symbol: string,
  quantity: string,
  stopPrice: string,
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
    },
  );
}

/** OCO на продажу: лимитный тейк выше рынка + стоп-маркет ниже. */
export async function demoSpotOcoSell(
  creds: BinanceCredentials,
  symbol: string,
  quantity: string,
  takeProfit: string,
  stopLoss: string,
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
    params,
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

/** Изолированная маржа и плечо для символа. «Уже установлено» — не ошибка. */
export async function demoFuturesPrepare(
  creds: BinanceCredentials,
  symbol: string,
  leverage: number,
): Promise<void> {
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
    // -4046: No need to change margin type.
    if (!(error instanceof BinanceApiError && error.code === -4046))
      throw error;
  }
  await signedRequest(
    DEMO_URL.futures,
    creds,
    "POST",
    "/fapi/v1/leverage",
    anySchema,
    { symbol, leverage },
  );
}

export async function demoFuturesMarketOrder(
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
): Promise<FuturesOrder> {
  return signedRequest(
    DEMO_URL.futures,
    creds,
    "POST",
    "/fapi/v1/order",
    futuresOrderSchema,
    { symbol, side, type: "MARKET", quantity, newOrderRespType: "RESULT" },
  );
}

/** Условный ордер, закрывающий всю позицию при достижении цены (TP или SL). */
export async function demoFuturesCloseAt(
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
  triggerPrice: string,
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
      closePosition: true,
      workingType: "MARK_PRICE",
      priceProtect: true,
    },
  );
}

/** Закрытие (части) фьючерсной позиции по рынку: reduceOnly — не откроет встречную позицию. */
export async function demoFuturesReduceMarket(
  creds: BinanceCredentials,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: string,
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
      reduceOnly: true,
      newOrderRespType: "RESULT",
    },
  );
}

/** Binance: -2011 Unknown order / нет открытых ордеров — для «отменить всё» это не ошибка. */
const isNothingToCancel = (error: unknown) =>
  error instanceof BinanceApiError && error.code === -2011;

/**
 * Отменяет все открытые ордера по символу: spot — включая OCO; futures — обычные и algo (TP/SL).
 * Нечего отменять — не ошибка.
 */
export async function demoCancelAllOrders(
  creds: BinanceCredentials,
  market: Market,
  symbol: string,
): Promise<void> {
  const paths =
    market === "spot"
      ? ["/api/v3/openOrders"]
      : ["/fapi/v1/allOpenOrders", "/fapi/v1/algoOpenOrders"];
  for (const path of paths) {
    try {
      await signedRequest(DEMO_URL[market], creds, "DELETE", path, anySchema, {
        symbol,
      });
    } catch (error) {
      if (!isNothingToCancel(error)) throw error;
    }
  }
}

/** Текущая позиция по символу на демо-фьючерсах (размер со знаком: минус — шорт). */
export async function demoFuturesPosition(
  creds: BinanceCredentials,
  symbol: string,
): Promise<{ amount: number; entryPrice: number }> {
  const rows = await signedRequest(
    DEMO_URL.futures,
    creds,
    "GET",
    "/fapi/v3/positionRisk",
    positionRiskSchema,
    { symbol },
  );
  const amount = rows.reduce((s, r) => s + r.positionAmt, 0);
  return {
    amount,
    entryPrice: rows.find((r) => r.positionAmt !== 0)?.entryPrice ?? 0,
  };
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
      futures: [
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
    futures: [
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
