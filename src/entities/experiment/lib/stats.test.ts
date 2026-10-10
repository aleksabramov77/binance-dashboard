import { describe, expect, it } from "vitest";
import {
  computeStats,
  equityCurve,
  groupStats,
  maxDrawdown,
  type StatsTrade,
} from "./stats";

const closed = (
  closedAt: string,
  pnl: number,
  rMultiple: number | null = null,
  fees = 1,
): StatsTrade => ({
  openedAt: "2026-10-10T00:00:00Z",
  closedAt,
  pnl,
  fees,
  rMultiple,
});
const open: StatsTrade = {
  openedAt: "2026-10-10T00:00:00Z",
  closedAt: null,
  pnl: null,
  fees: 0,
  rMultiple: null,
};

describe("computeStats", () => {
  it("пустой список — нули и null там, где делить не на что", () => {
    const s = computeStats([], 10_000);
    expect(s).toMatchObject({
      trades: 0,
      closed: 0,
      open: 0,
      winRate: null,
      profitFactor: null,
      avgR: null,
      realizedPnl: 0,
      maxDrawdown: 0,
      equity: 10_000,
    });
  });

  it("считает win rate, PnL, комиссии, profit factor и средний R по закрытым сделкам", () => {
    const s = computeStats(
      [
        closed("2026-10-10T01:00:00Z", 100, 2),
        closed("2026-10-10T02:00:00Z", -50, -1),
        closed("2026-10-10T03:00:00Z", 30, null),
        open,
      ],
      1000,
    );
    expect(s.trades).toBe(4);
    expect(s.closed).toBe(3);
    expect(s.open).toBe(1);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.realizedPnl).toBe(80);
    expect(s.fees).toBe(3);
    expect(s.profitFactor).toBeCloseTo(130 / 50);
    expect(s.avgR).toBeCloseTo(0.5);
    expect(s.equity).toBe(1080);
  });

  it("max drawdown — по equity в порядке закрытия, а не в порядке списка", () => {
    const s = computeStats(
      [
        closed("2026-10-10T04:00:00Z", 50),
        closed("2026-10-10T01:00:00Z", 100),
        closed("2026-10-10T02:00:00Z", -80),
        closed("2026-10-10T03:00:00Z", -40),
      ],
      1000,
    );
    // 1000 → 1100 (пик) → 1020 → 980 → 1030: просадка 120.
    expect(s.maxDrawdown).toBe(120);
    expect(s.maxDrawdownPct).toBeCloseTo(120 / 1100);
  });

  it("без убыточных сделок profit factor — null", () => {
    expect(
      computeStats([closed("2026-10-10T01:00:00Z", 10)], 100).profitFactor,
    ).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("монотонный рост — просадки нет", () => {
    expect(maxDrawdown([1, 2, 3])).toEqual({ usd: 0, pct: 0 });
  });
});

describe("equityCurve", () => {
  it("начинается со старта эпохи и копит PnL закрытых сделок по времени", () => {
    expect(
      equityCurve(
        [
          closed("2026-10-10T02:00:00Z", -20),
          open,
          closed("2026-10-10T01:00:00Z", 50),
        ],
        1000,
        "2026-10-10T00:00:00Z",
      ),
    ).toEqual([
      { at: "2026-10-10T00:00:00Z", equity: 1000 },
      { at: "2026-10-10T01:00:00Z", equity: 1050 },
      { at: "2026-10-10T02:00:00Z", equity: 1030 },
    ]);
  });
});

describe("groupStats", () => {
  it("группирует по ключу, берёт бюджет группы и сортирует по PnL", () => {
    const trades = [
      { ...closed("2026-10-10T01:00:00Z", 10), market: "spot" as const },
      { ...closed("2026-10-10T02:00:00Z", 40), market: "futures" as const },
      { ...closed("2026-10-10T03:00:00Z", -5), market: "spot" as const },
    ];
    const groups = groupStats(
      trades,
      (t) => t.market,
      (m) => (m === "spot" ? 100 : 200),
    );
    expect(groups.map((g) => g.key)).toEqual(["futures", "spot"]);
    expect(groups[1].stats).toMatchObject({
      closed: 2,
      realizedPnl: 5,
      equity: 105,
    });
    expect(groups[0].stats.equity).toBe(240);
  });

  it("без бюджета equity группы равна её PnL", () => {
    const [g] = groupStats([closed("2026-10-10T01:00:00Z", 7)], () => "all");
    expect(g.stats.equity).toBe(7);
  });
});
