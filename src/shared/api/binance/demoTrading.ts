import type { BinanceCredentials } from "@/shared/config/env.server";
import {
  algoOrderSchema,
  anySchema,
  exchangeInfoSchema,
  type FuturesOrder,
  futuresBalancesSchema,
  futuresOrderSchema,
  orderListSchema,
  priceSchema,
  type SpotOrder,
  spotAccountBalancesSchema,
  spotOrderSchema,
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

const rulesCache = new Map<
  Market,
  { at: number; bySymbol: Map<string, SymbolRules> }
>();

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance Demo ответил ${res.status} на ${url}`);
  return res.json();
}

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

/** Правила округления символа на демо; null — символа нет в Demo Trading. */
export async function fetchDemoSymbolRules(
  market: Market,
  symbol: string,
): Promise<SymbolRules | null> {
  const cached = rulesCache.get(market);
  if (!cached || Date.now() - cached.at > RULES_TTL_MS) {
    const info = exchangeInfoSchema.parse(
      await getJson(`${DEMO_URL[market]}${PREFIX[market]}/exchangeInfo`),
    );
    const bySymbol = new Map<string, SymbolRules>();
    for (const s of info.symbols) {
      const rules = s.status === "TRADING" ? toRules(s.filters) : null;
      if (rules) bySymbol.set(s.symbol, rules);
    }
    rulesCache.set(market, { at: Date.now(), bySymbol });
  }
  return rulesCache.get(market)?.bySymbol.get(symbol) ?? null;
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
