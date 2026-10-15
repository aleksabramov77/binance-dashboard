import {
  futuresExchangeInfoSchema,
  klinesSchema,
  premiumIndexSchema,
  type Ticker24h,
  ticker24hSchema,
} from "./marketSchemas.ts";

// Публичные рыночные запросы Binance (без ключа), среда-независимые: Node на сервере и Deno в Edge
// Function Supabase (spec 007b). Без @/…, node:* и env: транспорт (повторы, журнал) — аргумент getJson.

export type Market = "spot" | "futures";

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

const BASE: Record<Market, string> = {
  spot: "https://api.binance.com/api/v3",
  futures: "https://fapi.binance.com/fapi/v1",
};

/**
 * Базовый актив фьючерса — криптовалюта: underlyingType COIN (не индекс INDEX и не пре-маркет PREMARKET).
 * Подтип RWA не учитываем: его носят и монеты RWA-сектора (MANTRA, CFG); токены золота PAXG и XAUT — тоже
 * COIN, их отсекает список не-крипто потребителя. Акции и сырьё — отдельный contractType TRADIFI_PERPETUAL.
 */
function isCryptoUnderlying(contract: {
  underlyingType?: string | null;
}): boolean {
  return contract.underlyingType === "COIN";
}

export function createMarketApi(getJson: GetJson) {
  return {
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

    /** Свечи: без startTime — последние limit, со startTime — до limit штук начиная с него (мс). */
    async fetchKlines(
      market: Market,
      symbol: string,
      interval: string,
      limit: number,
      startTime?: number,
    ): Promise<Candle[]> {
      const from = startTime === undefined ? "" : `&startTime=${startTime}`;
      const raw = klinesSchema.parse(
        await getJson(
          `${BASE[market]}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${from}`,
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

    /**
     * Символы бессрочных USDT-фьючерсов, по которым идёт торговля. cryptoOnly — только контракты на
     * монеты: без индексов (BTCDOMUSDT) и пре-маркета — isCryptoUnderlying.
     */
    async fetchPerpetualSymbols(
      options: { cryptoOnly?: boolean } = {},
    ): Promise<Set<string>> {
      const info = futuresExchangeInfoSchema.parse(
        await getJson(`${BASE.futures}/exchangeInfo`),
      );
      return new Set(
        info.symbols
          .filter(
            (s) =>
              s.contractType === "PERPETUAL" &&
              s.quoteAsset === "USDT" &&
              s.status === "TRADING" &&
              (!options.cryptoOnly || isCryptoUnderlying(s)),
          )
          .map((s) => s.symbol),
      );
    },

    /** Текущие ставки funding бессрочных фьючерсов (доля за период): { BTCUSDT: 0.0001 }. */
    async fetchFundingRates(): Promise<Record<string, number>> {
      const list = premiumIndexSchema.parse(
        await getJson(`${BASE.futures}/premiumIndex`),
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
