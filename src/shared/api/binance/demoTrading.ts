import { isStablecoin } from "@/shared/config";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { getJsonWithRetry, HttpError } from "@/shared/lib/fetchRetry";
import {
  algoOrderSchema,
  anySchema,
  exchangeInfoSchema,
  type FuturesOrder,
  futuresBalancesSchema,
  futuresOrderSchema,
  futuresUserTradesSchema,
  orderListSchema,
  positionRiskSchema,
  priceSchema,
  type SpotOrder,
  spotAccountBalancesSchema,
  spotMyTradesSchema,
  spotOrderSchema,
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

export interface SymbolRules {
  tickSize: string;
  stepSize: string;
  minQty: number;
  minNotional: number;
}

/** Справочник демо-фьючерсов (~900 КБ) — грузим редко, держим последнюю удачную копию. */
let futuresRules: { at: number; bySymbol: Map<string, SymbolRules> } | null =
  null;

const getJson = (url: string) => getJsonWithRetry(url, "Binance Demo");

/** Binance: -1121 Invalid symbol. */
const isInvalidSymbol = (error: unknown) =>
  error instanceof HttpError &&
  (error.body as { code?: number } | null)?.code === -1121;

function toRules(
  filters: { filterType: string; [k: string]: unknown }[],
): SymbolRules | null {
  const get = (type: string) => filters.find((f) => f.filterType === type);
  const price = get("PRICE_FILTER");
  const lot = get("LOT_SIZE");
  const notional = get("NOTIONAL") ?? get("MIN_NOTIONAL");
  if (!price || !lot) return null;
  return {
    tickSize: String(price.tickSize),
    stepSize: String(lot.stepSize),
    minQty: Number(lot.minQty ?? 0),
    minNotional: Number(notional?.minNotional ?? notional?.notional ?? 0),
  };
}

function indexRules(raw: unknown): Map<string, SymbolRules> {
  const info = exchangeInfoSchema.parse(raw);
  const bySymbol = new Map<string, SymbolRules>();
  for (const s of info.symbols) {
    const rules = s.status === "TRADING" ? toRules(s.filters) : null;
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
      return indexRules(raw).get(symbol) ?? null;
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
      futuresRules = { at: Date.now(), bySymbol: indexRules(raw) };
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

/**
 * Символы, по которым на демо-счёте могли быть сделки. История сделок Binance
 * требует symbol, поэтому собираем их из запросов без символа. Spot: OCO-история
 * (каждая spot-сделка из дашборда ставит OCO), открытые ордера, монеты на балансе.
 * Futures: income-история (комиссии и PnL), позиции, открытые и algo-ордера.
 */
export async function fetchDemoTradedSymbols(
  creds: BinanceCredentials,
): Promise<Record<Market, string[]>> {
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
  const [orderLists, spotOpen, account, income, positions, futOpen, algoOpen] =
    await Promise.all([
      spot("/api/v3/allOrderList", { limit: 1000 }),
      spot("/api/v3/openOrders"),
      signedRequest(
        DEMO_URL.spot,
        creds,
        "GET",
        "/api/v3/account",
        spotAccountBalancesSchema,
        { omitZeroBalances: true },
      ),
      futures("/fapi/v1/income", { limit: 1000 }),
      signedRequest(
        DEMO_URL.futures,
        creds,
        "GET",
        "/fapi/v3/positionRisk",
        positionRiskSchema,
      ),
      futures("/fapi/v1/openOrders"),
      futures("/fapi/v1/openAlgoOrders"),
    ]);
  const held = account.balances
    .filter((b) => b.free + b.locked > 0 && !isStablecoin(b.asset))
    .map((b) => `${b.asset}USDT`);
  return {
    spot: [
      ...new Set([...symbolsOf(orderLists), ...symbolsOf(spotOpen), ...held]),
    ],
    futures: [
      ...new Set([
        ...symbolsOf(income),
        ...symbolsOf(positions.filter((p) => p.positionAmt !== 0)),
        ...symbolsOf(futOpen),
        ...symbolsOf(algoOpen),
      ]),
    ],
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
