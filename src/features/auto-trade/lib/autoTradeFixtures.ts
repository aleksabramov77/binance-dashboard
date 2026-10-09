import type { Setup } from "@/entities/market-signal";

/** Сетап для тестов: шорт BAT на фьючерсах. */
export const makeSetup = (patch: Partial<Setup> = {}): Setup => ({
  id: `${patch.symbol ?? "BATUSDT"}:${patch.direction ?? "short"}`,
  symbol: "BATUSDT",
  base: "BAT",
  kind: "overheat-short",
  direction: "short",
  market: "futures",
  status: "ready",
  entry: 0.13,
  stopLoss: 0.14,
  takeProfit1: 0.12,
  takeProfit2: 0.11,
  rr: 1,
  strength: 0.5,
  reasons: [],
  change24h: 0.2,
  quoteVolumeUsd: 1e8,
  indicators: {
    rsi1h: 80,
    rsi4h: 70,
    atr1h: 0.003,
    ema20: 0.12,
    ema50: 0.11,
    volumeRatio: 2,
    distanceAtr: 4,
  },
  demoTradable: true,
  ...patch,
});
