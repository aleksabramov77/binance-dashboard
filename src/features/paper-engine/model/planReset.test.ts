import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { planReset, priceKey } from "./planReset.ts";

const NOW = Date.parse("2026-10-10T12:34:56Z");

const exp = (id: string, timeframe: "15m" | "1h" | "4h"): Experiment => ({
  id,
  market: "usdm",
  name: id,
  hypothesis: "тест",
  initialBudget: 10_000,
  enabled: true,
  demoMirror: false,
  config: {
    timeframe,
    entry: { type: "hold" },
    exit: { stop: { type: "none" }, takeProfit: null },
    universe: { type: "majors" },
    directions: ["long"],
    maxOpen: 1,
  },
});

const trade = (patch: Partial<PaperTrade>): PaperTrade => ({
  id: "1-A-BTCUSDT-0",
  runId: 1,
  experimentId: "A",
  market: "usdm",
  symbol: "BTCUSDT",
  direction: "long",
  openedAt: "2026-10-10T10:00:00.000Z",
  entryPrice: 100,
  quantity: 10,
  initialStop: 98,
  stop: 98,
  takeProfit: null,
  atr: 1,
  extreme: 100,
  checkedUntil: 0,
  closedAt: null,
  exitPrice: null,
  exitReason: null,
  fees: 0.5,
  pnl: null,
  rMultiple: null,
  demoOrderRef: null,
  signal: {},
  ...patch,
});

describe("planReset", () => {
  it("закрывает по последней цене со слиппеджем, причина manual, PnL с комиссиями", () => {
    const plan = planReset({
      experiments: [],
      open: [trade({})],
      prices: { [priceKey("usdm", "BTCUSDT")]: 110 },
      now: NOW,
    });
    const [c] = plan.closes;
    expect(c.noPrice).toBe(false);
    expect(c.close.exitReason).toBe("manual");
    expect(c.close.closedAt).toBe(new Date(NOW).toISOString());
    expect(c.close.exitPrice).toBeCloseTo(110 * (1 - 0.0005));
    // (109,945 − 100) × 10 − 0,0005 × 10 × (100 + 109,945)
    expect(c.close.pnl).toBeCloseTo(99.45 - 1.049725);
    expect(c.close.rMultiple).toBeCloseTo((c.close.pnl ?? 0) / 20);
  });

  it("short закрывается дороже рынка; цена другого рынка не подходит", () => {
    const plan = planReset({
      experiments: [],
      open: [
        trade({ id: "s", direction: "short" }),
        trade({ id: "spot", market: "spot", symbol: "ETHUSDT" }),
      ],
      prices: {
        [priceKey("usdm", "BTCUSDT")]: 90,
        [priceKey("usdm", "ETHUSDT")]: 2000,
      },
      now: NOW,
    });
    expect(plan.closes[0].close.exitPrice).toBeCloseTo(90 * 1.0005);
    expect(plan.closes[0].close.pnl).toBeGreaterThan(0);
    expect(plan.closes[1].noPrice).toBe(true);
  });

  it("нет цены — по цене входа, PnL 0 и пометка noPrice", () => {
    const [c] = planReset({
      experiments: [],
      open: [trade({})],
      prices: {},
      now: NOW,
    }).closes;
    expect(c.noPrice).toBe(true);
    expect(c.close).toMatchObject({
      exitPrice: 100,
      exitReason: "manual",
      pnl: 0,
      rMultiple: 0,
      fees: 0.5,
    });
  });

  it("метки свечей — последняя закрытая свеча TF каждого эксперимента", () => {
    const { bars } = planReset({
      experiments: [exp("A", "15m"), exp("B", "1h"), exp("C", "4h")],
      open: [],
      prices: {},
      now: NOW,
    });
    expect(bars).toEqual({
      A: Date.parse("2026-10-10T12:15:00Z"),
      B: Date.parse("2026-10-10T11:00:00Z"),
      C: Date.parse("2026-10-10T08:00:00Z"),
    });
  });
});
