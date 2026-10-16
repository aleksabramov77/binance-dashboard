import type {
  Candle,
  PaperTrade,
  SkippedSignal,
} from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import {
  afterExitMove,
  type FetchKlines,
  klineKey,
  klineRequests,
  loadKlines,
  SKIPPED_HORIZON_BARS,
  skippedOutcome,
} from "./labKlines";

const H1 = 3_600_000;
const T0 = Date.parse("2026-10-10T00:00:00Z");

const candle = (openTime: number, patch: Partial<Candle> = {}): Candle => ({
  openTime,
  open: 100,
  high: 100.5,
  low: 99.5,
  close: 100,
  volume: 1,
  ...patch,
});

const trade = (patch: Partial<PaperTrade> = {}): PaperTrade => ({
  id: "t",
  runId: 1,
  experimentId: "PS99",
  market: "spot",
  symbol: "ETHUSDT",
  direction: "long",
  openedAt: new Date(T0).toISOString(),
  entryPrice: 100,
  quantity: 1,
  initialStop: 98,
  stop: 98,
  takeProfit: 104,
  atr: 1,
  extreme: 100,
  mae: 100,
  checkedUntil: 0,
  closedAt: new Date(T0 + 2 * H1 + 60_000).toISOString(),
  exitPrice: 100,
  exitReason: "time",
  fees: 0,
  pnl: 0,
  rMultiple: 0,
  demoOrderRef: null,
  signal: {},
  entryContext: {},
  ...patch,
});

const skip = (patch: Partial<SkippedSignal> = {}): SkippedSignal => ({
  id: "s",
  runId: 1,
  experimentId: "PS99",
  market: "spot",
  symbol: "ETHUSDT",
  direction: "long",
  bar: T0,
  at: new Date(T0 + H1).toISOString(),
  reason: "max-open",
  entryPrice: 100,
  stop: 99,
  takeProfit: 102,
  ...patch,
});

describe("klineRequests", () => {
  it("после выхода — 24 свечи ТФ, после сигнала — горизонт; один диапазон на (рынок, символ, ТФ)", () => {
    const requests = klineRequests(
      [trade(), trade({ id: "open", closedAt: null, exitPrice: null })],
      [skip()],
      () => "1h",
    );
    expect(requests).toEqual([
      {
        market: "spot",
        symbol: "ETHUSDT",
        tf: "1h",
        from: T0 + H1,
        to: T0 + SKIPPED_HORIZON_BARS * H1,
      },
    ]);
    expect(klineRequests([trade()], [], () => undefined)).toEqual([]);
  });
});

describe("loadKlines", () => {
  it("страницы по 1000 от from, незакрытые отбрасываются, сбой символа — onError", async () => {
    const calls: number[] = [];
    const fetch: FetchKlines = async (_m, symbol, _i, limit, start) => {
      if (symbol === "BADUSDT") throw new Error("нет сети");
      calls.push(start);
      return Array.from({ length: limit }, (_, i) =>
        candle(start + i * H1),
      ).filter((c) => c.openTime <= T0 + 1500 * H1);
    };
    const errors: string[] = [];
    const set = await loadKlines(
      [
        {
          market: "spot",
          symbol: "ETHUSDT",
          tf: "1h",
          from: T0,
          to: T0 + 1400 * H1,
        },
        { market: "spot", symbol: "BADUSDT", tf: "1h", from: T0, to: T0 },
      ],
      fetch,
      T0 + 1500 * H1 + 30 * 60_000,
      (r) => errors.push(r.symbol),
    );
    expect(calls).toEqual([T0, T0 + 1000 * H1]);
    const eth = set.get(klineKey("spot", "ETHUSDT", "1h")) ?? [];
    expect(eth[0].openTime).toBe(T0);
    // Свеча 1500 не закрыта к now — отброшена.
    expect(eth.at(-1)?.openTime).toBe(T0 + 1499 * H1);
    expect(errors).toEqual(["BADUSDT"]);
  });
});

describe("afterExitMove", () => {
  it("ход через N свечей после свечи выхода в сторону сделки, % и R; нет свечи — null", () => {
    const candles = [candle(T0 + 6 * H1, { close: 102 })];
    const move = afterExitMove(trade(), candles, H1, 4);
    expect(move?.movePct).toBeCloseTo(2);
    expect(move?.moveR).toBeCloseTo(1);
    expect(
      afterExitMove(trade({ direction: "short" }), candles, H1, 4)?.movePct,
    ).toBeCloseTo(-2);
    expect(afterExitMove(trade(), candles, H1, 12)).toBeNull();
    expect(
      afterExitMove(trade({ initialStop: null }), candles, H1, 4)?.moveR,
    ).toBeNull();
  });
});

describe("skippedOutcome", () => {
  const after = (i: number, patch: Partial<Candle>) =>
    candle(T0 + i * H1, patch);

  it("первая свеча после сигнала, задевшая стоп или тейк; обе — стоп", () => {
    expect(
      skippedOutcome(skip(), [after(1, {}), after(2, { high: 102.5 })], H1),
    ).toEqual({ result: "tp", r: 2 });
    expect(skippedOutcome(skip(), [after(1, { low: 98.9 })], H1)).toEqual({
      result: "sl",
      r: -1,
    });
    expect(
      skippedOutcome(skip(), [after(1, { low: 98, high: 103 })], H1),
    ).toEqual({ result: "sl", r: -1 });
    expect(
      skippedOutcome(
        skip({ direction: "short", stop: 101, takeProfit: 98 }),
        [after(1, { low: 97.5 })],
        H1,
      ),
    ).toEqual({ result: "tp", r: 2 });
  });

  it("свеча сигнала и свечи после горизонта не считаются; без стопа или свечей — null", () => {
    expect(
      skippedOutcome(
        skip(),
        [
          candle(T0, { low: 90 }),
          after(1, { close: 100.5 }),
          after(SKIPPED_HORIZON_BARS + 1, { high: 110 }),
        ],
        H1,
      ),
    ).toEqual({ result: "open", r: 0.5 });
    expect(skippedOutcome(skip({ stop: null }), [after(1, {})], H1)).toBeNull();
    expect(skippedOutcome(skip(), [], H1)).toBeNull();
  });
});
