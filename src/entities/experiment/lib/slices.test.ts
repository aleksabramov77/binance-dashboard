import { describe, expect, it } from "vitest";
import { parseStatsQuery } from "../model/statsView";
import {
  blacklistCandidates,
  filterTrades,
  periodStart,
  rankGroups,
  type SliceExperiment,
  type SliceTrade,
  sliceStats,
} from "./slices";

const NOW = Date.parse("2026-10-10T12:00:00Z");

const t = (
  experimentId: string,
  market: SliceTrade["market"],
  symbol: string,
  direction: SliceTrade["direction"],
  pnl: number | null,
  closedAt: string | null = "2026-10-10T10:00:00Z",
  openedAt = "2026-10-01T00:00:00Z",
): SliceTrade => ({
  experimentId,
  market,
  symbol,
  direction,
  openedAt,
  closedAt: pnl === null ? null : closedAt,
  pnl,
  fees: 1,
  rMultiple: pnl === null ? null : pnl / 10,
});

const TRADES: SliceTrade[] = [
  t("F01", "futures", "BTCUSDT", "long", 50),
  t("F01", "futures", "ETHUSDT", "short", -20),
  t("F02", "futures", "BTCUSDT", "short", 30, "2026-10-05T00:00:00Z"),
  t("S01", "spot", "SOLUSDT", "long", -40, "2026-10-01T06:00:00Z"),
  t("S01", "spot", "BTCUSDT", "long", null, null, "2026-10-10T11:00:00Z"),
];

const EXPERIMENTS: SliceExperiment[] = [
  { id: "F01", market: "futures", initialBudget: 1000 },
  { id: "F02", market: "futures", initialBudget: 500 },
  { id: "S01", market: "spot", initialBudget: 2000 },
];

describe("filterTrades", () => {
  it("без фильтров — все сделки", () => {
    expect(filterTrades(TRADES, {})).toHaveLength(5);
  });

  it("рынок, эксперимент, направление и монета сочетаются через «и»", () => {
    expect(filterTrades(TRADES, { market: "futures" })).toHaveLength(3);
    expect(filterTrades(TRADES, { experiment: "S01" })).toHaveLength(2);
    expect(filterTrades(TRADES, { direction: "short" })).toHaveLength(2);
    expect(
      filterTrades(TRADES, { market: "futures", symbol: "BTCUSDT" }).map(
        (x) => x.experimentId,
      ),
    ).toEqual(["F01", "F02"]);
    expect(
      filterTrades(TRADES, { market: "spot", direction: "short" }),
    ).toEqual([]);
  });

  it("период: закрытые — по времени закрытия, открытые — по времени открытия", () => {
    const day = filterTrades(TRADES, { since: periodStart("24h", NOW) });
    // F01 ×2 закрыты сегодня, открытая S01 открыта час назад; F02 (5-го) и S01 (1-го) — мимо.
    expect(day.map((x) => `${x.experimentId}:${x.symbol}`)).toEqual([
      "F01:BTCUSDT",
      "F01:ETHUSDT",
      "S01:BTCUSDT",
    ]);
    expect(
      filterTrades(TRADES, { since: periodStart("7d", NOW) }),
    ).toHaveLength(4);
    expect(periodStart("epoch", NOW)).toBeNull();
  });
});

describe("sliceStats", () => {
  it("по эксперименту: бюджет группы — бюджет эксперимента, порядок по PnL", () => {
    const groups = sliceStats(TRADES, "experiment", EXPERIMENTS);
    expect(groups.map((g) => [g.key, g.stats.realizedPnl])).toEqual([
      // Равный PnL — порядок появления (сортировка стабильная).
      ["F01", 30],
      ["F02", 30],
      ["S01", -40],
    ]);
    expect(groups.find((g) => g.key === "F01")?.stats.equity).toBe(1030);
    expect(groups.find((g) => g.key === "S01")?.stats).toMatchObject({
      trades: 2,
      closed: 1,
      open: 1,
      equity: 1960,
    });
  });

  it("по рынку: бюджет — сумма бюджетов экспериментов рынка", () => {
    const groups = sliceStats(TRADES, "market", EXPERIMENTS);
    expect(groups.map((g) => g.key)).toEqual(["futures", "spot"]);
    expect(groups[0].stats).toMatchObject({
      closed: 3,
      realizedPnl: 60,
      fees: 3,
      initialBudget: 1500,
      equity: 1560,
    });
    expect(groups[1].stats.initialBudget).toBe(2000);
  });

  it("по монете и направлению: без капитала, просадка в USD", () => {
    const bySymbol = sliceStats(TRADES, "symbol", EXPERIMENTS);
    expect(bySymbol.map((g) => [g.key, g.stats.realizedPnl])).toEqual([
      ["BTCUSDT", 80],
      ["ETHUSDT", -20],
      ["SOLUSDT", -40],
    ]);
    expect(bySymbol[0].stats.initialBudget).toBe(0);

    const byDirection = sliceStats(TRADES, "direction", EXPERIMENTS);
    expect(byDirection.map((g) => [g.key, g.stats.realizedPnl])).toEqual([
      ["long", 10],
      ["short", 10],
    ]);
    const long = byDirection.find((g) => g.key === "long");
    // long: S01 −40 (1-го), F01 +50 (10-го): equity 0 → −40 → +10, просадка 40 $.
    expect(long?.stats.maxDrawdown).toBe(40);
    expect(long?.stats.winRate).toBe(0.5);
  });

  it("фильтр + разрез: монеты futures в шортах", () => {
    const groups = sliceStats(
      filterTrades(TRADES, { market: "futures", direction: "short" }),
      "symbol",
      EXPERIMENTS,
    );
    expect(groups.map((g) => [g.key, g.stats.realizedPnl])).toEqual([
      ["BTCUSDT", 30],
      ["ETHUSDT", -20],
    ]);
  });
});

describe("rankGroups и blacklistCandidates", () => {
  const groups = sliceStats(
    [
      t("F01", "futures", "AAAUSDT", "long", 10),
      t("F01", "futures", "BBBUSDT", "long", 40),
      t("F01", "futures", "CCCUSDT", "long", -5),
      t("F01", "futures", "DDDUSDT", "long", -50),
      t("F01", "futures", "EEEUSDT", "long", 0),
      t("F01", "futures", "FFFUSDT", "long", null),
      t("F01", "futures", "GGGUSDT", "long", 25),
      t("F01", "futures", "HHHUSDT", "long", 5),
    ],
    "symbol",
    EXPERIMENTS,
  );

  it("топ-3 прибыльных и топ-3 убыточных; нулевые и без закрытых — ни туда ни туда", () => {
    const { best, worst } = rankGroups(groups);
    expect(best.map((g) => g.key)).toEqual(["BBBUSDT", "GGGUSDT", "AAAUSDT"]);
    expect(worst.map((g) => g.key)).toEqual(["DDDUSDT", "CCCUSDT"]);
  });

  it("кандидаты в blacklist — убыточные монеты, худшие первыми, не больше n", () => {
    expect([...blacklistCandidates(groups)]).toEqual(["DDDUSDT", "CCCUSDT"]);
    expect([...blacklistCandidates(groups, 1)]).toEqual(["DDDUSDT"]);
  });
});

describe("parseStatsQuery", () => {
  it("значения по умолчанию и пустые параметры как отсутствующие", () => {
    const r = parseStatsQuery(new URLSearchParams("market=&symbol="));
    expect(r.success && r.data).toEqual({
      groupBy: "experiment",
      period: "epoch",
    });
  });

  it("разбирает все фильтры и эпоху", () => {
    const r = parseStatsQuery(
      new URLSearchParams(
        "groupBy=symbol&market=spot&experiment=S01&direction=long&symbol=BTCUSDT&period=7d&run=2",
      ),
    );
    expect(r.success && r.data).toEqual({
      groupBy: "symbol",
      market: "spot",
      experiment: "S01",
      direction: "long",
      symbol: "BTCUSDT",
      period: "7d",
      run: 2,
    });
  });

  it("неизвестный разрез или рынок — ошибка", () => {
    expect(parseStatsQuery(new URLSearchParams("groupBy=hour")).success).toBe(
      false,
    );
    expect(parseStatsQuery(new URLSearchParams("market=margin")).success).toBe(
      false,
    );
  });
});
