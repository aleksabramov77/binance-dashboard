import type { Mover, Setup, SetupRecheck } from "@/entities/market-signal";
import { fetch24hTicker, fetchKlines } from "@/shared/api/binance";
import { computeIndicators } from "../lib/computeIndicators";
import { detectSetup, ruleChecks } from "../lib/detectSetup";
import { evaluateRecheck } from "../lib/evaluateRecheck";

/** Пересчитывает сетап по свежим свечам и цене прямо перед сделкой (без кэша сканера). */
export async function recheckSetup(setup: Setup): Promise<SetupRecheck> {
  const market = setup.market;
  const [ticker, h1, h4] = await Promise.all([
    fetch24hTicker(market, setup.symbol),
    fetchKlines(market, setup.symbol, "1h", 200),
    fetchKlines(market, setup.symbol, "4h", 100),
  ]);

  const mover: Mover = {
    symbol: setup.symbol,
    base: setup.base,
    spot: market === "spot",
    futures: market === "futures",
    price: ticker.lastPrice,
    change24h: ticker.priceChangePercent / 100,
    quoteVolumeUsd: ticker.quoteVolume,
    indicators: computeIndicators(h1, h4),
  };
  const fresh = detectSetup(mover, h1);
  return evaluateRecheck(
    setup,
    mover.price,
    fresh ? { ...fresh, market } : null,
    ruleChecks(mover, setup.direction),
    new Date().toISOString(),
  );
}
