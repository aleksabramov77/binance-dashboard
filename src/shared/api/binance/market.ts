import {
  futuresExchangeInfoSchema,
  klinesSchema,
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

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance ответил ${res.status} на ${url}`);
  return res.json();
}

export async function fetch24hTickers(market: Market): Promise<Ticker24h[]> {
  return ticker24hSchema.parse(await getJson(`${BASE[market]}/ticker/24hr`));
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
