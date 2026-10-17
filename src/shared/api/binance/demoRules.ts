import type { BinanceMarket } from "./markets";

// Правила символа из exchangeInfo демо-биржи (чистый разбор, без сети — сеть в demoTrading.ts).

/**
 * Допустимый коридор цены ордера относительно средней цены (множители). bid — для BUY,
 * ask — для SELL: цена/стоп SELL-ордера должны быть в [avg × askDown, avg × askUp].
 */
export interface PriceBand {
  bidUp: number;
  bidDown: number;
  askUp: number;
  askDown: number;
}

export interface SymbolRules {
  tickSize: string;
  stepSize: string;
  minQty: number;
  minNotional: number;
  /**
   * Фильтр PERCENT_PRICE_BY_SIDE / PERCENT_PRICE — только спот. На фьючерсах PERCENT_PRICE
   * касается лимитных цен, а условные algo-ордера (STOP_MARKET / TAKE_PROFIT_MARKET) он не
   * ограничивает: на демо 2026-10-15 стояли триггеры 0,81…1,28 от mark price. null — фильтра нет.
   */
  priceBand: PriceBand | null;
  /** Спот: разрешены составные заявки OTO (и OTOCO, если ещё и OCO). */
  otoAllowed: boolean;
  ocoAllowed: boolean;
  /**
   * COIN-M (spec 0056): количество ордера — в контрактах (шаг 1), контракт стоит size $ (BTC — 100, остальные — 10),
   * маржа — в монете marginAsset. Нет — количество в монете (Spot, USDⓈ-M).
   */
  contract?: CoinmContract;
}

/** Бессрочный контракт COIN-M: размер в $ и монета маржи (exchangeInfo demo-dapi, проба 2026-10-17). */
export interface CoinmContract {
  size: number;
  marginAsset: string;
}

type Filter = { filterType: string; [k: string]: unknown };

const num = (v: unknown) => (v === undefined ? Number.NaN : Number(v));

/** Коридор цены: PERCENT_PRICE_BY_SIDE (по сторонам) или PERCENT_PRICE (общий). */
export function toPriceBand(filters: Filter[]): PriceBand | null {
  const bySide = filters.find((f) => f.filterType === "PERCENT_PRICE_BY_SIDE");
  if (bySide) {
    const band = {
      bidUp: num(bySide.bidMultiplierUp),
      bidDown: num(bySide.bidMultiplierDown),
      askUp: num(bySide.askMultiplierUp),
      askDown: num(bySide.askMultiplierDown),
    };
    return Object.values(band).every(Number.isFinite) ? band : null;
  }
  const common = filters.find((f) => f.filterType === "PERCENT_PRICE");
  if (common) {
    const up = num(common.multiplierUp);
    const down = num(common.multiplierDown);
    if (!Number.isFinite(up) || !Number.isFinite(down)) return null;
    return { bidUp: up, bidDown: down, askUp: up, askDown: down };
  }
  return null;
}

/** Правила символа из его фильтров; null — нет PRICE_FILTER / LOT_SIZE (торговать нельзя). */
export function toRules(
  market: BinanceMarket,
  symbol: {
    filters: Filter[];
    otoAllowed?: boolean;
    ocoAllowed?: boolean;
    contractSize?: number;
    marginAsset?: string;
  },
): SymbolRules | null {
  const { filters } = symbol;
  const get = (type: string) => filters.find((f) => f.filterType === type);
  const price = get("PRICE_FILTER");
  const lot = get("LOT_SIZE");
  const notional = get("NOTIONAL") ?? get("MIN_NOTIONAL");
  if (!price || !lot) return null;
  // COIN-M без размера контракта или монеты маржи — объём не перевести в контракты: торговать нельзя.
  const contract =
    market === "coinm"
      ? symbol.contractSize && symbol.contractSize > 0 && symbol.marginAsset
        ? { size: symbol.contractSize, marginAsset: symbol.marginAsset }
        : null
      : undefined;
  if (contract === null) return null;
  return {
    tickSize: String(price.tickSize),
    stepSize: String(lot.stepSize),
    minQty: Number(lot.minQty ?? 0),
    minNotional: Number(notional?.minNotional ?? notional?.notional ?? 0),
    priceBand: market === "spot" ? toPriceBand(filters) : null,
    otoAllowed: market === "spot" && symbol.otoAllowed === true,
    ocoAllowed: market === "spot" && symbol.ocoAllowed === true,
    ...(contract && { contract }),
  };
}
