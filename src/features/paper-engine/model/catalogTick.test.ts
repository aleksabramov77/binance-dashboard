import type { Candle } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { EXPERIMENT_CATALOG } from "../config/catalog";
import { seededRandom } from "../lib/candles";
import type { MarketTicker } from "../lib/universe";
import { createMemoryStore } from "./memoryStore";
import { type Interval, runTick, type TickDeps } from "./runTick";
import { ENGINE_KEYS } from "./store";

const MIN = 60_000;
const MS: Record<Interval, number> = {
  "1m": MIN,
  "5m": 5 * MIN,
  "15m": 15 * MIN,
  "1h": 60 * MIN,
  "4h": 240 * MIN,
  "1d": 1440 * MIN,
};
const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "PIXELUSDT",
  "OPUSDT",
];

/** Случайное блуждание: свеча зависит только от (symbol, interval, openTime) — детерминированно. */
function walkCandle(
  symbol: string,
  interval: Interval,
  openTime: number,
): Candle {
  const r = (k: string) =>
    seededRandom(`${symbol}:${interval}:${openTime}:${k}`);
  const base = 100 * (1 + 0.3 * Math.sin(openTime / (MS[interval] * 37)));
  const open = base * (1 + (r("o") - 0.5) * 0.02);
  const close = base * (1 + (r("c") - 0.5) * 0.02);
  return {
    openTime,
    open,
    close,
    high: Math.max(open, close) * (1 + r("h") * 0.01),
    low: Math.min(open, close) * (1 - r("l") * 0.01),
    volume: 100 * (1 + 5 * r("v") ** 4),
  };
}

describe("каталог на синтетическом рынке", () => {
  it("40 экспериментов проходят тики без ошибок, сделки валидны", async () => {
    const store = createMemoryStore(EXPERIMENT_CATALOG, {
      [ENGINE_KEYS.enabled]: true,
    });
    let now = Date.parse("2026-10-10T00:00:30Z");
    const deps: TickDeps = {
      runner: "oracle",
      store,
      cache: new Map(),
      candles: async (_m, symbol, interval, limit) => {
        const ms = MS[interval];
        const current = Math.floor(now / ms) * ms;
        return Array.from({ length: limit }, (_, i) =>
          walkCandle(symbol, interval, current - (limit - 1 - i) * ms),
        );
      },
      tickers: async (): Promise<MarketTicker[]> =>
        SYMBOLS.map((symbol, i) => ({
          symbol,
          lastPrice: walkCandle(symbol, "1m", Math.floor(now / MIN) * MIN)
            .close,
          priceChangePercent: (i - 4) * 5,
          quoteVolume: 1e9 / (i + 1),
        })),
      funding: async () => ({ BTCUSDT: 0.001, ETHUSDT: -0.001 }),
    };
    let errors = 0;
    // 6 часов по 5 минут.
    for (let i = 0; i < 72; i++) {
      const r = await runTick(deps, now);
      errors += r.errors.length;
      now += 5 * MIN;
    }
    expect(errors).toBe(0);
    const trades = store.trades();
    expect(trades.length).toBeGreaterThan(0);
    for (const t of trades) {
      expect(Number.isFinite(t.entryPrice) && t.quantity > 0).toBe(true);
      expect(t.entryPrice * t.quantity).toBeLessThanOrEqual(1000.01);
      if (t.market === "spot") expect(t.direction).toBe("long");
    }
    const perExp = new Map<string, number>();
    for (const t of trades.filter((x) => x.closedAt === null))
      perExp.set(t.experimentId, (perExp.get(t.experimentId) ?? 0) + 1);
    for (const e of EXPERIMENT_CATALOG)
      expect(perExp.get(e.id) ?? 0).toBeLessThanOrEqual(e.config.maxOpen);
  });
});
