import { MAX_RISK_PCT } from "@/entities/trade";
import { demoVenue, type TradeVenue } from "@/shared/api/binance/venue.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { FUTURES_AUTO_HEDGE } from "../config/trade";

// Площадка сделки (spec 0049): одна логика ордеров для Binance Demo и реального счёта. Демо — по умолчанию, из
// BINANCE_DEMO_* (поведение до 0049 не меняется); реальный счёт передаёт воркер (scripts/live-worker.ts).

export interface TradeVenueContext {
  venue: TradeVenue;
  /** Лимит объёма одной сделки, $ (демо — DEMO_MAX_NOTIONAL_USD). */
  maxNotionalUsd: number;
  /** Максимальная потеря на стопе, доля свободных средств кошелька. */
  maxRiskPct: number;
  /**
   * Можно ли переключать пустой счёт фьючерсов в Hedge mode перед входом. Демо — FUTURES_AUTO_HEDGE; реальный
   * счёт — нет: там одна позиция на монету (One-way), режим держит воркер.
   */
  autoHedge: boolean;
}

/** Контекст Binance Demo из env; null — ключ демо не задан. */
export function demoTradeContext(): TradeVenueContext | null {
  const config = getDemoTradingConfig();
  if (!config) return null;
  return {
    venue: demoVenue(config.credentials),
    maxNotionalUsd: config.maxNotionalUsd,
    maxRiskPct: MAX_RISK_PCT,
    autoHedge: FUTURES_AUTO_HEDGE,
  };
}
