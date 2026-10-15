import type { PaperTrade } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import type { LabExperiment } from "@/entities/experiment";
import { EXPERIMENT_CATALOG } from "@/features/paper-engine";
import type { MarketContext } from "./labMarket";
import {
  archetypeOf,
  buildLabReport,
  controlsOf,
  type LabDataset,
  meanStat,
  mfeR,
  parseSince,
  renderLabReport,
  renderTradesCsv,
  sampleLevel,
} from "./labReport";

const HOUR = 3_600_000;
const START = Date.parse("2026-10-01T00:00:00Z");
const NOW = START + 10 * 24 * HOUR;

const experiment = (
  id: string,
  resetAt: string | null = null,
): LabExperiment => {
  const e = EXPERIMENT_CATALOG.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return { ...e, resetAt };
};

let seq = 0;
/** Закрытая long-сделка $50 со стопом 1R = 1 $ цены: вход 100, стоп 99; удержание 30 мин. */
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
    market: experimentId.startsWith("F")
      ? "usdm"
      : experimentId.startsWith("PC")
        ? "coinm"
        : "spot",
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

const many = (n: number, make: (i: number) => PaperTrade) =>
  Array.from({ length: n }, (_, i) => make(i));

const dataset = (
  experiments: LabExperiment[],
  trades: PaperTrade[],
): LabDataset => ({
  run: { id: 1, startedAt: new Date(START).toISOString() },
  experiments,
  trades,
});

const only = (id: string, trades: PaperTrade[]) =>
  buildLabReport(dataset([experiment(id)], trades), { now: NOW })
    .experiments[0];

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

describe("archetypeOf", () => {
  it("по типу входа; продолжение пампа — тренд, остальной сканер — контртренд", () => {
    expect(archetypeOf({ type: "emaCross", fast: 9, slow: 21 })).toBe("trend");
    expect(archetypeOf({ type: "donchian", period: 20 })).toBe("breakout");
    expect(archetypeOf({ type: "rsi2", threshold: 10, trendSma: 200 })).toBe(
      "meanReversion",
    );
    expect(archetypeOf({ type: "counterTrend", mode: "rebound" })).toBe(
      "meanReversion",
    );
    expect(
      archetypeOf({ type: "counterTrend", mode: "pumpContinuation" }),
    ).toBe("trend");
    expect(archetypeOf({ type: "random", probability: 0.02 })).toBe("control");
  });
});

describe("controlsOf", () => {
  it("контроль каждого рынка — по типу входа, отсутствующий — null", () => {
    expect(
      controlsOf([experiment("S19"), experiment("S20"), experiment("F19")]),
    ).toEqual({
      spot: { random: "S19", hold: "S20" },
      usdm: { random: "F19", hold: null },
      coinm: { random: null, hold: null },
    });
  });

  it("COIN-M — своя группа: контроль и архетипы не смешиваются с USDⓈ-M (spec 0023)", () => {
    // Фиктивная копия F19 в группе COIN-M (приватные эксперименты в тестах — только фиктивные).
    const coinm: LabExperiment = {
      ...experiment("F19"),
      id: "PC99",
      market: "coinm",
    };
    expect(controlsOf([experiment("F19"), coinm])).toMatchObject({
      usdm: { random: "F19" },
      coinm: { random: "PC99" },
    });
    const report = buildLabReport(
      dataset(
        [experiment("F19"), coinm],
        [trade("F19", 1), trade("PC99", -1), trade("PC99", 1)],
      ),
      { now: NOW },
    );
    expect(
      report.archetypes.map((a) => [a.market, a.archetype, a.closed]),
    ).toEqual([
      ["usdm", "control", 1],
      ["coinm", "control", 2],
    ]);
    expect(renderLabReport(report)).toContain("coinm — PC99 (случайный вход)");
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
      { now: NOW, database: "Postgres test" },
    );
    expect(report.database).toBe("Postgres test");
    expect(report.controls.spot).toEqual({ random: "S19", hold: null });
    const s04 = report.experiments.find((e) => e.id === "S04");
    expect(s04?.archetype).toBe("trend");
    expect(s04?.stats.closed).toBe(5);
    expect(s04?.sample).toBe("insufficient");
    expect(s04?.r.mean).toBeCloseTo(0.2);
    expect(s04?.periodDays).toBeCloseTo(10);
    expect(s04?.tradesPerDay).toBeCloseTo(0.5);
    expect(s04?.daysTo.preliminary).toBeCloseTo(50);
    expect(s04?.avgHoldMinutes).toBeCloseTo(30);
    expect(s04?.avgHoldBars).toBeCloseTo(2); // 15m
    expect(s04?.mfe.losersReached1R).toBe(1);
    expect(s04?.mfe.losersWithStop).toBe(3);
    expect(s04?.mfe.winnersRealizedAvgR).toBeCloseTo(2);
    expect(s04?.payoff).toBeCloseTo(2);
    // S04: 0,2R × 1% = 0,2%; S19: (1 − 1 − 1)/3 % ≈ −0,333%
    expect(s04?.vsRandomPct).toBeCloseTo(0.2 + 1 / 3);
    expect(report.experiments[0].id).toBe("S04");
    expect(report.experiments.find((e) => e.id === "S19")?.vsRandomPct).toBe(
      null,
    );
    expect(report.archetypes).toEqual([
      expect.objectContaining({
        market: "spot",
        archetype: "trend",
        experiments: 1,
        closed: 5,
      }),
      expect.objectContaining({
        market: "spot",
        archetype: "control",
        experiments: 1,
        closed: 3,
      }),
    ]);
    expect(report.legend).toContain("Доли");
  });

  it("без контроля в выборке сравнение с ним — null", () => {
    expect(only("S04", [trade("S04", 1), trade("S04", 1)]).vsRandomPct).toBe(
      null,
    );
  });

  it("PnL до комиссий и разрезы по направлению, причине выхода, часу и дню", () => {
    const report = buildLabReport(
      dataset(
        [experiment("F04")],
        [
          trade("F04", 2, {
            fees: 0.1,
            openedAt: "2026-10-02T01:00:00Z",
            closedAt: "2026-10-02T02:00:00Z",
          }),
          trade("F04", -1, {
            direction: "short",
            initialStop: 101,
            exitPrice: 101,
            fees: 0.1,
            openedAt: "2026-10-03T13:00:00Z", // суббота
            closedAt: "2026-10-03T14:00:00Z",
          }),
        ],
      ),
      { now: NOW },
    );
    const [f04] = report.experiments;
    expect(f04.pnlBeforeFees).toBeCloseTo(0.5 + 0.2);
    expect(f04.byDirection.map((r) => r.key)).toEqual(["long", "short"]);
    expect(f04.byExitReason.map((r) => r.key)).toEqual(["tp", "sl"]);
    expect(f04.byHourUtc.map((r) => r.key)).toEqual(["00–04", "12–16"]);
    expect(f04.byDay.map((r) => r.key)).toEqual(["2026-10-02", "2026-10-03"]);
    expect(f04.byWeekpart).toEqual([
      expect.objectContaining({ key: "будни", closed: 1 }),
      expect.objectContaining({ key: "выходные", closed: 1 }),
    ]);
  });

  it("сброс эксперимента: учёт и темп сделок — с даты сброса", () => {
    const resetAt = new Date(START + 8 * 24 * HOUR).toISOString();
    const [s04] = buildLabReport(
      dataset(
        [experiment("S04", resetAt)],
        [
          trade("S04", 1, {
            openedAt: new Date(START + 9 * 24 * HOUR).toISOString(),
            closedAt: new Date(START + 9 * 24 * HOUR + HOUR).toISOString(),
          }),
        ],
      ),
      { now: NOW },
    ).experiments;
    expect(s04.resetAt).toBe(resetAt);
    expect(s04.accountedFrom).toBe(resetAt);
    expect(s04.periodDays).toBeCloseTo(2);
    expect(s04.tradesPerDay).toBeCloseTo(0.5);
    expect(s04.hints).toEqual(["rare-signal"]); // 29 сделок при 0,5/день — 58 дней
    expect(
      renderLabReport(
        buildLabReport(dataset([experiment("S04", resetAt)], []), {
          now: NOW,
        }),
      ),
    ).toContain("Учёт с 2026-10-09 00:00 UTC (сброс эксперимента)");
  });

  it("концентрация: доля лучшей монеты, крупнейшей сделки и доходность без неё", () => {
    const c = only("S07", [
      trade("S07", 3, { symbol: "SOLUSDT" }),
      trade("S07", 1),
      trade("S07", -1),
    ]).concentration;
    expect(c.topSymbol).toBe("SOLUSDT");
    expect(c.topPnl).toBeCloseTo(1.5);
    expect(c.topShare).toBeCloseTo(1);
    expect(c.topTradeShare).toBeCloseTo(1);
    expect(c.avgReturnPctWithoutTop).toBeCloseTo(0);
  });

  it("семейства: один вход и ТФ по конфигу, контроль не группируется, в отличиях — только несовпадающее", () => {
    const report = buildLabReport(
      dataset(
        [
          experiment("S04"),
          experiment("S05"),
          experiment("F04"),
          experiment("S07"),
          experiment("S19"),
          experiment("F19"),
        ],
        [trade("S04", 1), trade("S05", -1), trade("F04", 1)],
      ),
      { now: NOW },
    );
    expect(report.families).toHaveLength(1);
    const [family] = report.families;
    expect(family.label).toBe("пересечение EMA 9 и EMA 21, 15m");
    expect(family.members.map((m) => m.id).sort()).toEqual([
      "F04",
      "S04",
      "S05",
    ]);
    const s05 = family.members.find((m) => m.id === "S05");
    expect(s05?.variant).toContain("Трейлинг: 3 × ATR");
    expect(s05?.variant).not.toContain("Юниверс");
    expect(s05?.closed).toBe(1);
  });

  it("закрытие в ту же минуту, что вход, — флаг; в следующую — нет", () => {
    const s04 = only("S04", [
      trade("S04", -1, {
        openedAt: "2026-10-02T10:00:10Z",
        closedAt: "2026-10-02T10:00:50Z",
      }),
      trade("S04", -1, {
        openedAt: "2026-10-02T11:00:40Z",
        closedAt: "2026-10-02T11:01:00Z",
      }),
    ]);
    expect(s04.flags).toEqual(["1 сделок закрыты по tp/sl в минуту входа"]);
  });

  it("подозрительно хорошие результаты — флаги и подсказка engine", () => {
    const s04 = only(
      "S04",
      many(30, () => trade("S04", 2, { rMultiple: 3 })),
    );
    expect(s04.flags).toEqual([
      "win rate > 90% на 30+ закрытых",
      "нет убыточных сделок на 30+ закрытых",
      "30 сделок по tp с R выше цели 2R",
    ]);
    expect(s04.hints).toContain("engine");
  });

  describe("подсказки о причине результата", () => {
    it("costs: до комиссий плюс, после — минус", () => {
      const s04 = only(
        "S04",
        many(10, () => trade("S04", -0.04, { fees: 0.1, pnl: -0.02 })),
      );
      expect(s04.pnlBeforeFees).toBeCloseTo(0.8);
      expect(s04.hints).toEqual(["costs"]);
    });

    it("exit-gives-back: убыточные были в плюсе ≥ 1R", () => {
      const s04 = only(
        "S04",
        many(10, () => trade("S04", -1, { extreme: 101.5 })),
      );
      expect(s04.hints).toEqual(["exit-gives-back"]);
    });

    it("exit-cuts-winners: прибыльные удерживают меньше половины MFE", () => {
      const s04 = only(
        "S04",
        many(10, () => trade("S04", 1, { extreme: 103 })),
      );
      expect(s04.hints).toEqual(["exit-cuts-winners", "concentration"]);
    });

    it("stop-in-noise: стопы раньше одной свечи ТФ", () => {
      const s04 = only(
        "S04",
        many(10, (i) =>
          trade("S04", -1, {
            openedAt: new Date(START + i * HOUR).toISOString(),
            closedAt: new Date(START + i * HOUR + 5 * 60_000).toISOString(),
          }),
        ),
      );
      expect(s04.stopsInFirstBarShare).toBe(1);
      expect(s04.hints).toEqual(["stop-in-noise"]);
    });

    it("direction: стороны с противоположным результатом", () => {
      const f04 = only("F04", [
        ...many(10, () => trade("F04", 1, { extreme: 101 })),
        ...many(10, () =>
          trade("F04", -1, {
            direction: "short",
            initialStop: 101,
            exitPrice: 101,
            extreme: 100,
          }),
        ),
      ]);
      expect(f04.hints).toEqual(["direction"]);
    });

    it("rare-signal: 30 сделок не наберётся за месяц; к контролю не относится", () => {
      expect(only("S04", [trade("S04", 1), trade("S04", -1)]).hints).toEqual([
        "rare-signal",
      ]);
      expect(only("S20", []).hints).toEqual([]);
      expect(only("S19", [trade("S19", -1)]).hints).toEqual([]);
    });

    it("no-edge: на 30+ сделках ожидание неотличимо от нуля", () => {
      const s04 = only(
        "S04",
        many(30, (i) =>
          trade("S04", i % 2 ? 1 : -1, { extreme: i % 2 ? 101 : 100 }),
        ),
      );
      expect(s04.returnPct.t).toBeCloseTo(0);
      expect(s04.hints).toEqual(["no-edge"]);
    });

    it("negative-edge: устойчиво против — не no-edge, а кандидат на инверсию", () => {
      const s04 = only(
        "S04",
        many(30, (i) => trade("S04", i % 2 ? -1 : -0.5)),
      );
      expect(s04.returnPct.t).toBeLessThan(-2);
      expect(s04.hints).toEqual(["negative-edge"]);
    });
  });

  it("фокус: расчёты по всем, подробные разделы — по выбранным; неизвестный id — ошибка", () => {
    const data = dataset(
      [experiment("S04"), experiment("S05"), experiment("S19")],
      [trade("S04", 2), trade("S05", -1), trade("S19", -1)],
    );
    const report = buildLabReport(data, {
      now: NOW,
      focus: ["S04"],
      since: parseSince("3d", NOW),
    });
    expect(report.focus).toEqual(["S04"]);
    expect(report.periodDays).toBeCloseTo(3);
    expect(report.experiments.map((e) => e.id).sort()).toEqual([
      "S04",
      "S05",
      "S19",
    ]);
    const md = renderLabReport(report);
    expect(md).toContain("Фокус: S04");
    expect(md).toContain("| **S04** |");
    expect(md).toContain("### S04 ·");
    expect(md).not.toContain("### S05 ·");
    expect(() => buildLabReport(data, { now: NOW, focus: ["S99"] })).toThrow(
      /нет экспериментов S99/,
    );
  });

  it("период --since: сделки до него не учитываются, открытые — не в ожидании", () => {
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
    const [s04] = buildLabReport(
      dataset([experiment("S04")], [old, open, fresh]),
      { now: NOW, since: parseSince("3d", NOW) },
    ).experiments;
    expect(s04.stats.closed).toBe(1);
    expect(s04.stats.open).toBe(1);
    expect(s04.r.mean).toBe(-1);
  });

  it("markdown: БД, рынок, сводка, архетипы, семейства и разделы экспериментов", () => {
    const market: MarketContext = {
      symbol: "BTCUSDT",
      lastPrice: 100,
      periodReturnPct: -1.6,
      periodMaxDrawdownPct: 0.028,
      ema200_4h: 105,
      aboveEma200: false,
      adx14_4h: 24,
      atrPct14_4h: 1.08,
      regime: "drift-down",
      regimeAtStart: "range",
      daily: [{ date: "2026-10-01", returnPct: 0.4 }],
    };
    const data = dataset(
      [experiment("S04"), experiment("S05")],
      [trade("S04", 2), trade("S04", -1)],
    );
    const md = renderLabReport(
      buildLabReport(data, { now: NOW, market, database: "Postgres x/y" }),
    );
    expect(md).toContain("БД: Postgres x/y.");
    expect(md).toContain("**Рынок.** BTCUSDT: за период -1.6%");
    expect(md).toContain("режим за период: флэт → слабое снижение");
    expect(md).toContain("BTC по дням: 10-01 +0.4%.");
    expect(md).toContain("Контроль: spot — нет (случайный вход)");
    expect(md).toContain("## Сводка");
    expect(md).toContain("## Архетипы");
    expect(md).toContain("## Семейства");
    expect(md).toContain("### S04 · EMA 9/21, 15m, TP 2R");
    expect(md).toContain("**Причина выхода**");
    expect(md).toContain("Подсказки: rare-signal.");
    expect(md).toContain("Закрытых сделок нет (открыто 0).");
    expect(
      renderLabReport(buildLabReport(data, { now: NOW, market: null })),
    ).toContain("Контекст рынка не загружен");
  });
});

describe("renderTradesCsv", () => {
  it("заголовок, расчётные колонки, открытая сделка с пустыми полями", () => {
    const csv = renderTradesCsv([
      trade("S04", 2, { id: "a", extreme: 103 }),
      trade("S04", 0, {
        id: "b",
        closedAt: null,
        pnl: null,
        rMultiple: null,
        exitPrice: null,
        exitReason: null,
      }),
    ]);
    const [header, a, b] = csv.split("\n");
    expect(header.startsWith("id,experimentId,market,symbol")).toBe(true);
    expect(header.endsWith("rMultiple,mfeR,returnPct,holdMinutes")).toBe(true);
    expect(a.startsWith("a,S04,spot,BTCUSDT,long,")).toBe(true);
    expect(a.endsWith(",tp,0,1,2,3,2,30")).toBe(true);
    expect(b).toContain(",,"); // closedAt пустой
    expect(b.endsWith(",0,,,0,,")).toBe(true);
  });
});
