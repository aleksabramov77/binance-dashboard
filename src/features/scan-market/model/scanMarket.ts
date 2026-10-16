import type { Mover, ScanResult, Setup } from "@/entities/market-signal";
import type { Candle, Ticker24h } from "@/shared/api/binance";
import {
  DEMO_PUBLIC_VENUE,
  fetchDemoSymbolRules,
} from "@/shared/api/binance/demo.server";
import {
  fetch24hTickers,
  fetchKlines,
  fetchPerpetualSymbols,
} from "@/shared/api/binance/public.server";
import { isStablecoin } from "@/shared/config";
import { log } from "@/shared/lib/logger.server";
import { SCAN_CONFIG } from "../config/rules";
import { computeIndicators } from "../lib/computeIndicators";
import { detectSetup } from "../lib/detectSetup";

const LEVERAGED_TOKEN = /(UP|DOWN|BULL|BEAR)USDT$/;

let cache: { at: number; result: ScanResult } | null = null;

function toMover(t: Ticker24h, spot: boolean, futures: boolean): Mover {
  return {
    symbol: t.symbol,
    base: t.symbol.replace(/USDT$/, ""),
    spot,
    futures,
    price: t.lastPrice,
    change24h: t.priceChangePercent / 100,
    quoteVolumeUsd: t.quoteVolume,
    indicators: null,
  };
}

/** Ликвидные USDT-рынки: фьючерсы (если есть) приоритетнее спота — по ним и шорт, и данные. */
function buildUniverse(
  spotTickers: Ticker24h[],
  futuresTickers: Ticker24h[],
  perps: Set<string>,
): Mover[] {
  const spotBySymbol = new Map(spotTickers.map((t) => [t.symbol, t]));
  const eligible = (symbol: string) =>
    symbol.endsWith("USDT") &&
    !LEVERAGED_TOKEN.test(symbol) &&
    !isStablecoin(symbol.replace(/USDT$/, ""));

  const futures = futuresTickers
    .filter(
      (t) =>
        perps.has(t.symbol) &&
        eligible(t.symbol) &&
        t.quoteVolume >= SCAN_CONFIG.minFuturesVolumeUsd,
    )
    .map((t) =>
      toMover(t, (spotBySymbol.get(t.symbol)?.quoteVolume ?? 0) > 0, true),
    );
  const covered = new Set(futures.map((m) => m.symbol));
  const spotOnly = spotTickers
    .filter(
      (t) =>
        !covered.has(t.symbol) &&
        eligible(t.symbol) &&
        t.quoteVolume >= SCAN_CONFIG.minSpotVolumeUsd,
    )
    .map((t) => toMover(t, true, false));
  return [...futures, ...spotOnly];
}

async function analyze(
  mover: Mover,
): Promise<{ mover: Mover; setup: Setup | null }> {
  const market = mover.futures ? "usdm" : "spot";
  try {
    const [h1, h4]: [Candle[], Candle[]] = await Promise.all([
      fetchKlines(market, mover.symbol, "1h", 200),
      fetchKlines(market, mover.symbol, "4h", 100),
    ]);
    const withIndicators = { ...mover, indicators: computeIndicators(h1, h4) };
    return { mover: withIndicators, setup: detectSetup(withIndicators, h1) };
  } catch (error) {
    // Монета выпадает из анализа, но скан продолжается.
    log.warn(
      "scan.symbol",
      `${mover.symbol}: не удалось загрузить свечи — монета пропущена`,
      { symbol: mover.symbol, market },
      error,
    );
    return { mover, setup: null };
  }
}

/** Лидеры роста и падения за 24 ч + индикаторы + торговые сетапы. Кэш на минуту. */
export async function scanMarket(force = false): Promise<ScanResult> {
  if (!force && cache && Date.now() - cache.at < SCAN_CONFIG.cacheTtlMs)
    return cache.result;
  const started = Date.now();

  const [spotTickers, futuresTickers, perps] = await Promise.all([
    fetch24hTickers("spot"),
    fetch24hTickers("usdm"),
    fetchPerpetualSymbols(),
  ]);
  const universe = buildUniverse(spotTickers, futuresTickers, perps).sort(
    (a, b) => a.change24h - b.change24h,
  );
  const losers = universe
    .slice(0, SCAN_CONFIG.topN)
    .filter((m) => m.change24h < 0);
  const gainers = universe
    .slice(-SCAN_CONFIG.topN)
    .reverse()
    .filter((m) => m.change24h > 0);

  const [analyzedLosers, analyzedGainers] = await Promise.all([
    Promise.all(losers.map(analyze)),
    Promise.all(gainers.map(analyze)),
  ]);
  const found = [...analyzedLosers, ...analyzedGainers]
    .map((a) => a.setup)
    .filter((s): s is Setup => s !== null);
  // Сразу помечаем, можно ли открыть сделку в демо, чтобы не узнавать это по отказу.
  const setups = (
    await Promise.all(
      found.map(async (s) => ({
        ...s,
        demoTradable: await fetchDemoSymbolRules(
          s.market,
          s.symbol,
          DEMO_PUBLIC_VENUE,
        )
          .then((rules) => rules !== null)
          .catch((error) => {
            log.warn(
              "scan.demo",
              `${s.symbol}: не удалось проверить наличие в демо`,
              { symbol: s.symbol, market: s.market },
              error,
            );
            return null;
          }),
      })),
    )
  ).sort(
    (a, b) =>
      Number(b.status === "ready") - Number(a.status === "ready") ||
      b.strength - a.strength,
  );

  const result: ScanResult = {
    scannedAt: new Date().toISOString(),
    universeSize: universe.length,
    gainers: analyzedGainers.map((a) => a.mover),
    losers: analyzedLosers.map((a) => a.mover),
    setups,
  };
  cache = { at: Date.now(), result };
  log.info(
    "scan.done",
    `Скан: ${universe.length} рынков, сетапов ${setups.length} за ${Date.now() - started} мс`,
    {
      universe: universe.length,
      setups: setups.map((s) => ({
        symbol: s.symbol,
        direction: s.direction,
        status: s.status,
        demoTradable: s.demoTradable,
      })),
      ms: Date.now() - started,
    },
  );
  return result;
}
