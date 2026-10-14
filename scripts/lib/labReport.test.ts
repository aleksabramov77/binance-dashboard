import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { EXPERIMENT_CATALOG } from "@/features/paper-engine";
import {
  buildLabReport,
  type LabDataset,
  meanStat,
  mfeR,
  parseSince,
  renderLabReport,
  sampleLevel,
} from "./labReport";

const HOUR = 3_600_000;
const START = Date.parse("2026-10-01T00:00:00Z");
const NOW = START + 10 * 24 * HOUR;

const experiment = (id: string): Experiment => {
  const e = EXPERIMENT_CATALOG.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};

let seq = 0;
/** Закрытая long-сделка $50 со стопом 1R = 1 $ цены: вход 100, стоп 99. */
function trade(
  experimentId: string,
  r: number,
  over: Partial<PaperTrade> = {},
): PaperTrade {
  seq += 1;
  const openedAt = new Date(START + seq * HOUR).toISOString();
  const quantity = 0.5;
  return {
    id: `t${seq}`,
    runId: 1,
    experimentId,
    market: experimentId.startsWith("F") ? "futures" : "spot",
    symbol: "BTCUSDT",
    direction: "long",
    openedAt,
    entryPrice: 100,
    quantity,
    initialStop: 99,
    stop: 99,
    takeProfit: 102,
    atr: 1,
    extreme: 100 + Math.max(r, 0),
    checkedUntil: 0,
    closedAt: new Date(START + seq * HOUR + 30 * 60_000).toISOString(),
    exitPrice: 100 + r,
    exitReason: r > 0 ? "tp" : "sl",
    fees: 0,
    pnl: r * quantity,
    rMultiple: r,
    demoOrderRef: null,
    signal: {},
    ...over,
  };
}

const dataset = (
  experiments: Experiment[],
  trades: PaperTrade[],
): LabDataset => ({
  run: { id: 1, startedAt: new Date(START).toISOString() },
  experiments,
  trades,
});

describe("meanStat", () => {
  it("среднее, sd и t", () => {
    const s = meanStat([1, -1, 1, -1, 2]);
    expect(s.mean).toBeCloseTo(0.4);
    expect(s.sd).toBeCloseTo(Math.sqrt(1.8));
    expect(s.t).toBeCloseTo(0.4 / (Math.sqrt(1.8) / Math.sqrt(5)));
  });
  it("мало значений — без t", () => {
    expect(meanStat([])).toEqual({ n: 0, mean: null, sd: null, t: null });
    expect(meanStat([2]).t).toBeNull();
  });
});

describe("sampleLevel", () => {
  it("пороги 30/100/200", () => {
    expect(sampleLevel(29)).toBe("insufficient");
    expect(sampleLevel(30)).toBe("preliminary");
    expect(sampleLevel(100)).toBe("decidable");
    expect(sampleLevel(200)).toBe("confident");
  });
});

describe("mfeR", () => {
  it("long и short в R от начального стопа", () => {
    expect(mfeR(trade("S04", 0, { extreme: 102 }))).toBeCloseTo(2);
    expect(
      mfeR(
        trade("F04", 0, {
          direction: "short",
          initialStop: 101,
          extreme: 98.5,
        }),
      ),
    ).toBeCloseTo(1.5);
  });
  it("свеча выхода учтена ценой выхода (extreme её не видит)", () => {
    expect(mfeR(trade("S04", 2, { extreme: 101 }))).toBeCloseTo(2);
  });
  it("без стопа — null", () => {
    expect(mfeR(trade("S20", 0, { initialStop: null }))).toBeNull();
  });
});

describe("parseSince", () => {
  it("относительный период и ISO", () => {
    expect(parseSince("7d", NOW)).toBe(NOW - 7 * 24 * HOUR);
    expect(parseSince("24h", NOW)).toBe(NOW - 24 * HOUR);
    expect(parseSince("2026-10-05T00:00:00Z", NOW)).toBe(
      Date.parse("2026-10-05T00:00:00Z"),
    );
    expect(() => parseSince("вчера", NOW)).toThrow();
  });
});

describe("buildLabReport", () => {
  it("ожидание, выборка, темп, отданная прибыль и сравнение с контролем", () => {
    const trades = [
      ...[2, 2, -1, -1].map((r) => trade("S04", r)),
      // убыточная, но была в плюсе на 1,5R — отданная прибыль
      trade("S04", -1, { extreme: 101.5 }),
      ...[1, -1, -1].map((r) => trade("S19", r)),
    ];
    const report = buildLabReport(
      dataset([experiment("S04"), experiment("S19")], trades),
      { now: NOW },
    );
    const s04 = report.experiments.find((e) => e.id === "S04");
    expect(s04?.stats.closed).toBe(5);
    expect(s04?.sample).toBe("insufficient");
    expect(s04?.r.mean).toBeCloseTo(0.2);
    expect(s04?.tradesPerDay).toBeCloseTo(0.5);
    expect(s04?.daysTo.preliminary).toBeCloseTo(50);
    expect(s04?.mfe.losersReached1R).toBe(1);
    expect(s04?.mfe.losersWithStop).toBe(3);
    expect(s04?.payoff).toBeCloseTo(2);
    // S04: 0,2R × 1% = 0,2%; S19: (1 − 1 − 1)/3 % ≈ −0,333%
    expect(s04?.vsRandomPct).toBeCloseTo(0.2 + 1 / 3);
    expect(report.experiments[0].id).toBe("S04");
    expect(report.experiments.find((e) => e.id === "S19")?.vsRandomPct).toBe(
      null,
    );
  });

  it("разрезы по направлению, причине выхода и часу UTC", () => {
    const report = buildLabReport(
      dataset(
        [experiment("F04")],
        [
          trade("F04", 2, {
            openedAt: "2026-10-02T01:00:00Z",
            closedAt: "2026-10-02T02:00:00Z",
          }),
          trade("F04", -1, {
            direction: "short",
            openedAt: "2026-10-02T13:00:00Z",
            closedAt: "2026-10-02T14:00:00Z",
          }),
        ],
      ),
      { now: NOW },
    );
    const [f04] = report.experiments;
    expect(f04.byDirection.map((r) => r.key)).toEqual(["long", "short"]);
    expect(f04.byExitReason.map((r) => r.key)).toEqual(["tp", "sl"]);
    expect(f04.byHourUtc.map((r) => r.key)).toEqual(["00–04", "12–16"]);
  });

  it("концентрация: доля лучшей монеты и доходность без неё", () => {
    const report = buildLabReport(
      dataset(
        [experiment("S07")],
        [
          trade("S07", 3, { symbol: "SOLUSDT" }),
          trade("S07", 1),
          trade("S07", -1),
        ],
      ),
      { now: NOW },
    );
    const c = report.experiments[0].concentration;
    expect(c.topSymbol).toBe("SOLUSDT");
    expect(c.topPnl).toBeCloseTo(1.5);
    expect(c.topShare).toBeCloseTo(1);
    expect(c.avgReturnPctWithoutTop).toBeCloseTo(0);
  });

  it("закрытие в ту же минуту, что вход, — флаг; в следующую — нет", () => {
    const [s04] = buildLabReport(
      dataset(
        [experiment("S04")],
        [
          trade("S04", -1, {
            openedAt: "2026-10-02T10:00:10Z",
            closedAt: "2026-10-02T10:00:50Z",
          }),
          trade("S04", -1, {
            openedAt: "2026-10-02T11:00:40Z",
            closedAt: "2026-10-02T11:01:00Z",
          }),
        ],
      ),
      { now: NOW },
    ).experiments;
    expect(s04.flags).toEqual(["1 сделок закрыты по tp/sl в минуту входа"]);
  });

  it("подозрительно хорошие результаты — флаги", () => {
    const trades = Array.from({ length: 30 }, () =>
      trade("S04", 2, { rMultiple: 3 }),
    );
    const [s04] = buildLabReport(dataset([experiment("S04")], trades), {
      now: NOW,
    }).experiments;
    expect(s04.flags).toEqual([
      "win rate > 90% при просадке < 5%",
      "нет убыточных сделок на 30+ закрытых",
      "30 сделок по tp с R выше цели 2R",
    ]);
  });

  it("фильтры по эксперименту и периоду; открытые сделки не в ожидании", () => {
    const old = trade("S04", 2, {
      openedAt: "2026-10-01T05:00:00Z",
      closedAt: "2026-10-01T06:00:00Z",
    });
    const open = trade("S04", 0, {
      closedAt: null,
      pnl: null,
      rMultiple: null,
      exitPrice: null,
      exitReason: null,
    });
    const fresh = trade("S04", -1, {
      openedAt: "2026-10-09T05:00:00Z",
      closedAt: "2026-10-09T06:00:00Z",
    });
    const report = buildLabReport(
      dataset(
        [experiment("S04"), experiment("S05")],
        [old, open, fresh, trade("S05", 1)],
      ),
      {
        now: NOW,
        experimentIds: ["S04"],
        since: parseSince("3d", NOW),
      },
    );
    expect(report.experiments.map((e) => e.id)).toEqual(["S04"]);
    expect(report.periodDays).toBeCloseTo(3);
    expect(report.experiments[0].stats.closed).toBe(1);
    expect(report.experiments[0].r.mean).toBe(-1);
  });

  it("markdown: сводка и разделы экспериментов", () => {
    const md = renderLabReport(
      buildLabReport(
        dataset(
          [experiment("S04"), experiment("S05")],
          [trade("S04", 2), trade("S04", -1)],
        ),
        { now: NOW },
      ),
    );
    expect(md).toContain("## Сводка");
    expect(md).toContain("### S04 · EMA 9/21, 15m, TP 2R");
    expect(md).toContain("**Причина выхода**");
    expect(md).toContain("Закрытых сделок нет (открыто 0).");
  });
});
