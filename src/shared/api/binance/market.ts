import { getJsonWithRetry } from "@/shared/lib/fetchRetry";
import {
  futuresExchangeInfoSchema,
  klinesSchema,
  premiumIndexSchema,
  type Ticker24h,
  ticker24hSchema,
} from "./marketSchemas";

export type Market = "spot" | "futures";

const BASE: Record<Market, string> = {
  spot: "https://api.binance.com/api/v3",
  futures: "https://fapi.binance.com/fapi/v1",
};

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const getJson = (url: string) => getJsonWithRetry(url, "Binance");

export async function fetch24hTickers(market: Market): Promise<Ticker24h[]> {
  return ticker24hSchema.parse(await getJson(`${BASE[market]}/ticker/24hr`));
}

/** Статистика за 24 ч по одному символу. */
export async function fetch24hTicker(
  market: Market,
  symbol: string,
): Promise<Ticker24h> {
  const raw = await getJson(`${BASE[market]}/ticker/24hr?symbol=${symbol}`);
  return ticker24hSchema.element.parse(raw);
}

export async function fetchKlines(
  market: Market,
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const raw = klinesSchema.parse(
    await getJson(
      `${BASE[market]}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    ),
  );
  return raw.map(([openTime, open, high, low, close, volume]) => ({
    openTime,
    open,
    high,
    low,
    close,
    volume,
  }));
}

/** Символы бессрочных USDT-фьючерсов, по которым идёт торговля. */
export async function fetchPerpetualSymbols(): Promise<Set<string>> {
  const info = futuresExchangeInfoSchema.parse(
    await getJson(`${BASE.futures}/exchangeInfo`),
  );
  return new Set(
    info.symbols
      .filter(
        (s) =>
          s.contractType === "PERPETUAL" &&
          s.quoteAsset === "USDT" &&
          s.status === "TRADING",
      )
      .map((s) => s.symbol),
  );
}

/** Текущие ставки funding бессрочных фьючерсов (доля за период): { BTCUSDT: 0.0001 }. Без ключа. */
export async function fetchFundingRates(): Promise<Record<string, number>> {
  const list = premiumIndexSchema.parse(
    await getJson(`${BASE.futures}/premiumIndex`),
  );
  const out: Record<string, number> = {};
  for (const p of list)
    if (typeof p.lastFundingRate === "number")
      out[p.symbol] = p.lastFundingRate;
  return out;
}
