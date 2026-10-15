import {
  type CoinmTicker24h,
  coinmTicker24hSchema,
  futuresExchangeInfoSchema,
  klinesSchema,
  premiumIndexSchema,
  type Ticker24h,
  ticker24hSchema,
} from "./marketSchemas.ts";
import type { BinanceMarket, FuturesMarket, Market } from "./markets.ts";

// Публичные рыночные запросы Binance (без ключа), среда-независимые: Node на сервере и Deno в Edge
// Function Supabase (spec 007b). Без @/…, node:* и env: транспорт (повторы, журнал) — аргумент getJson.

export type { BinanceMarket, FuturesMarket, Market } from "./markets.ts";

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** GET JSON; бросает ошибку при сетевом сбое или статусе не 2xx. */
export type GetJson = (url: string) => Promise<unknown>;

const BASE: Record<BinanceMarket, string> = {
  spot: "https://api.binance.com/api/v3",
  usdm: "https://fapi.binance.com/fapi/v1",
  coinm: "https://dapi.binance.com/dapi/v1",
};

/** Котировка бессрочных контрактов: USDⓈ-M — к USDT, COIN-M — к USD (BTCUSD_PERP). */
const PERPETUAL_QUOTE: Record<FuturesMarket, string> = {
  usdm: "USDT",
  coinm: "USD",
};

/** Бессрочный контракт в торговле: символ → размер контракта в USD (COIN-M) или null (USDⓈ-M: в монете). */
export type Perpetuals = Map<string, number | null>;

export function createMarketApi(getJson: GetJson) {
  /**
   * Бессрочные контракты рынка, по которым идёт торговля (USDⓈ-M — к USDT, COIN-M — к USD),
   * с размером контракта COIN-M. У dapi статус — contractStatus.
   */
  async function fetchPerpetuals(market: FuturesMarket): Promise<Perpetuals> {
    const info = futuresExchangeInfoSchema.parse(
      await getJson(`${BASE[market]}/exchangeInfo`),
    );
    const out: Perpetuals = new Map();
    for (const s of info.symbols)
      if (
        s.contractType === "PERPETUAL" &&
        s.quoteAsset === PERPETUAL_QUOTE[market] &&
        (s.status ?? s.contractStatus) === "TRADING"
      )
        out.set(s.symbol, market === "coinm" ? (s.contractSize ?? null) : null);
    return out;
  }

  return {
    fetchPerpetuals,

    /** Тикеры 24 ч Spot и USDⓈ-M (оборот в котировке — quoteVolume). COIN-M — fetchCoinmTickers. */
    async fetch24hTickers(market: Market): Promise<Ticker24h[]> {
      return ticker24hSchema.parse(
        await getJson(`${BASE[market]}/ticker/24hr`),
      );
    },

    /** Статистика за 24 ч по одному символу. */
    async fetch24hTicker(market: Market, symbol: string): Promise<Ticker24h> {
      const raw = await getJson(`${BASE[market]}/ticker/24hr?symbol=${symbol}`);
      return ticker24hSchema.element.parse(raw);
    },

    /** Тикеры 24 ч COIN-M: оборот — в контрактах (volume), в $ его переводит размер контракта. */
    async fetchCoinmTickers(): Promise<CoinmTicker24h[]> {
      return coinmTicker24hSchema.parse(
        await getJson(`${BASE.coinm}/ticker/24hr`),
      );
    },

    async fetchKlines(
      market: BinanceMarket,
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
    },

    /** Символы бессрочных USDT-фьючерсов (USDⓈ-M), по которым идёт торговля. */
    async fetchPerpetualSymbols(): Promise<Set<string>> {
      return new Set((await fetchPerpetuals("usdm")).keys());
    },

    /** Текущие ставки funding бессрочных фьючерсов рынка (доля за период): { BTCUSDT: 0.0001 }. */
    async fetchFundingRates(
      market: FuturesMarket = "usdm",
    ): Promise<Record<string, number>> {
      const list = premiumIndexSchema.parse(
        await getJson(`${BASE[market]}/premiumIndex`),
      );
      const out: Record<string, number> = {};
      for (const p of list)
        if (typeof p.lastFundingRate === "number")
          out[p.symbol] = p.lastFundingRate;
      return out;
    },
  };
}

export type MarketApi = ReturnType<typeof createMarketApi>;
