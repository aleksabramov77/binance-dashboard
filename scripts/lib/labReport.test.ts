import type {
  PaperTrade,
  SkippedSignal,
} from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import type { LabExperiment } from "@/entities/experiment";
import { ENGINE, EXPERIMENT_CATALOG } from "@/features/paper-engine";
import type { MarketContext } from "./labMarket";
import {
  archetypeOf,
  buildLabReport,
  controlsOf,
  costR,
  type LabDataset,
  maeR,
  meanStat,
  median,
  mfeR,
  parseSince,
  quantile,
  renderLabReport,
  renderTradesCsv,
  sampleLevel,
  tradeCosts,
  unrealizedStats,
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
    mae: null,
    entryContext: {},
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
    expect(header).toContain(
      "rMultiple,mfeR,returnPct,holdMinutes,mae,maeR,costR,ctx_atrPct,",
    );
    expect(header.endsWith("ctx_hourUtc,ctx_weekday")).toBe(true);
    expect(a.startsWith("a,S04,spot,BTCUSDT,long,")).toBe(true);
    expect(a).toContain(",tp,0,1,2,3,2,30,");
    expect(b).toContain(",,"); // closedAt пустой
    expect(b).toContain(",0,,,0,,");
  });

  it("MAE, издержки в R и снимок рынка на входе — свои столбцы; у сделок до spec 0030 — пусто", () => {
    const csv = renderTradesCsv([
      trade("F04", 1, {
        id: "c",
        mae: 99.5,
        fees: 0.1,
        entryContext: { v: 1, atrPct: 1.2, btcAboveEma200_4h: true },
      }),
      trade("F04", 1, { id: "d" }),
    ]);
    const [header, c, d] = csv.split("\n").map((line) => line.split(","));
    const col = (row: string[], name: string) => row[header.indexOf(name)];
    expect(col(c, "mae")).toBe("99.5");
    expect(col(c, "maeR")).toBe("0.5");
    expect(Number(col(c, "costR"))).toBeGreaterThan(0.2); // 0,1 $ комиссий + слиппедж при риске 0,5 $
    expect(col(c, "ctx_atrPct")).toBe("1.2");
    expect(col(c, "ctx_btcAboveEma200_4h")).toBe("true");
    expect(col(d, "maeR")).toBe("");
    expect(col(d, "ctx_atrPct")).toBe("");
  });
});

describe("издержки, MAE и квантили (spec 0030)", () => {
  it("tradeCosts: комиссии и слиппедж входа; тейк — без слиппеджа выхода", () => {
    const tp = trade("F04", 2, { entryPrice: 100.05, exitPrice: 102 });
    expect(tradeCosts(tp).slippage).toBeCloseTo(0.05 * 0.5, 4);
    const sl = trade("F04", -1, {
      entryPrice: 100.05,
      exitPrice: 98.95,
      exitReason: "sl",
    });
    // Выход по стопу по рынку: 98,95 = уровень × (1 − 0,05 %).
    expect(tradeCosts(sl).slippage).toBeCloseTo(
      (0.05 + 98.95 / (1 - 0.0005) - 98.95) * 0.5,
      4,
    );
  });

  it("costR и maeR: в долях риска до начального стопа; без стопа или MAE — null", () => {
    const t = trade("F04", 1, { fees: 0.25, mae: 99.4 });
    expect(maeR(t)).toBeCloseTo(0.6);
    expect(maeR(trade("F04", 1, { mae: null }))).toBeNull();
    expect(maeR(trade("S20", 1, { initialStop: null, mae: 90 }))).toBeNull();
    expect(
      maeR(
        trade("F04", 1, {
          direction: "short",
          initialStop: 101,
          mae: 100.8,
        }),
      ),
    ).toBeCloseTo(0.8);
    // риск 1 $ × 0,5 = 0,5 $; комиссии 0,25 $ = 0,5R плюс слиппедж входа
    expect(costR(t)).toBeGreaterThan(0.5);
    expect(costR(trade("S20", 1, { initialStop: null }))).toBeNull();
  });

  it("quantile и median", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5, 1, 3, 2, 4, 6, 7, 8, 9, 10], 0.9)).toBe(10);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("buildLabReport: spec 0030", () => {
  it("R до издержек и издержки в R: avg R = до − издержки; столбцы в сводке", () => {
    const report = buildLabReport(
      dataset(
        [experiment("F04")],
        [
          trade("F04", 2, { fees: 0.05, pnl: 0.95, rMultiple: 1.9 }),
          trade("F04", -1, { fees: 0.05, pnl: -0.55, rMultiple: -1.1 }),
        ],
      ),
      { now: NOW },
    );
    const [f04] = report.experiments;
    expect(f04.costs.feesUsd).toBeCloseTo(0.1);
    expect(f04.costs.grossAvgR).not.toBeNull();
    expect((f04.costs.grossAvgR ?? 0) - (f04.costs.costAvgR ?? 0)).toBeCloseTo(
      f04.r.mean ?? 0,
    );
    expect(f04.costs.costAvgR).toBeGreaterThan(0.1);
    const md = renderLabReport(report);
    expect(md).toContain("| avg R | R до изд. | Изд. R |");
    expect(md).toContain("Издержки: R до издержек");
  });

  it("MAE: прибыльные и убыточные, 90-й перцентиль; сделки без MAE не ломают отчёт", () => {
    const winners = many(10, (i) =>
      trade("F04", 2, { mae: 100 - (i + 1) * 0.05 }),
    );
    const f04 = only("F04", [
      ...winners,
      trade("F04", -1, { mae: 99 }),
      trade("F04", -1, { mae: null }),
    ]);
    expect(f04.mae.n).toBe(11);
    expect(f04.mae.winnersAvgR).toBeCloseTo(0.275);
    expect(f04.mae.winnersP90R).toBeCloseTo(0.5);
    expect(f04.mae.losersAvgR).toBeCloseTo(1);
    const old = only("F04", [trade("F04", 1), trade("F04", -1)]);
    expect(old.mae).toEqual({
      n: 0,
      winnersAvgR: null,
      winnersP90R: null,
      losersAvgR: null,
    });
    expect(old.contextCoverage).toBe(0);
    expect(old.byContext.adx).toEqual([
      expect.objectContaining({ key: "нет данных", closed: 2 }),
    ]);
    expect(
      renderLabReport(
        buildLabReport(dataset([experiment("F04")], [trade("F04", 1)]), {
          now: NOW,
        }),
      ),
    ).toContain("MAE: нет данных");
  });

  it("разрезы по контексту входа: режим BTC, ADX, терции ATR%, знак funding", () => {
    const ctx = (
      atrPct: number,
      adx14: number,
      funding: number,
      up: boolean,
    ) => ({
      v: 1,
      atrPct,
      adx14,
      funding,
      btcAboveEma200_4h: up,
      btcAdx14_4h: 30,
    });
    const f04 = only("F04", [
      trade("F04", 2, { entryContext: ctx(0.5, 15, 0.0001, true) }),
      trade("F04", 2, { entryContext: ctx(1, 22, 0.0001, true) }),
      trade("F04", -1, { entryContext: ctx(2, 30, -0.0001, false) }),
      trade("F04", -1, { entryContext: ctx(3, 45, -0.0001, false) }),
      trade("F04", -1, { entryContext: ctx(4, 50, 0, false) }),
      trade("F04", 1),
    ]);
    expect(f04.contextCoverage).toBeCloseTo(5 / 6);
    expect(f04.byContext.btcRegime.map((r) => [r.key, r.closed])).toEqual([
      ["тренд вверх", 2],
      ["нет данных", 1],
      ["тренд вниз", 3],
    ]);
    expect(f04.byContext.adx.map((r) => r.key)).toEqual([
      "1 < 20",
      "2 20–25",
      "3 25–40",
      "4 ≥ 40",
      "нет данных",
    ]);
    expect(f04.byContext.atrPct.map((r) => [r.key, r.closed])).toEqual([
      ["1 низкая ≤ 1", 2],
      ["2 средняя ≤ 3", 2],
      ["3 высокая > 3", 1],
      ["нет данных", 1],
    ]);
    expect(f04.byContext.funding.map((r) => r.key).sort()).toEqual(
      ["+ (лонги платят)", "0", "− (шорты платят)", "нет данных"].sort(),
    );
    expect(only("S04", [trade("S04", 1)]).byContext.funding).toEqual([]);
    expect(
      renderLabReport(
        buildLabReport(
          dataset(
            [experiment("F04")],
            [trade("F04", 2, { entryContext: ctx(0.5, 15, 0.0001, true) })],
          ),
          { now: NOW },
        ),
      ),
    ).toContain("**Режим BTC 4h на входе**");
  });

  it("отсечённые сигналы: число по причинам, лимит записи — нижняя оценка, --since", () => {
    const skip = (
      i: number,
      reason: SkippedSignal["reason"],
      at = "2026-10-05T00:00:00.000Z",
    ): SkippedSignal => ({
      id: `s${i}`,
      runId: 1,
      experimentId: "F04",
      market: "usdm",
      symbol: "ETHUSDT",
      direction: "long",
      bar: Date.parse(at) - HOUR,
      at,
      reason,
      entryPrice: 100,
      stop: 99,
      takeProfit: 102,
    });
    const data: LabDataset = {
      ...dataset([experiment("F04")], [trade("F04", 1)]),
      skipped: [
        skip(1, "max-open"),
        skip(2, "max-open"),
        skip(3, "no-budget", "2026-10-01T05:00:00.000Z"),
      ],
    };
    const [f04] = buildLabReport(data, { now: NOW }).experiments;
    expect(f04.skipped).toEqual({
      total: 3,
      byReason: { "max-open": 2, "symbol-busy": 0, "no-budget": 1 },
      capped: false,
      outcome: null,
    });
    const recent = buildLabReport(data, {
      now: NOW,
      since: Date.parse("2026-10-03T00:00:00Z"),
    }).experiments[0];
    expect(recent.skipped.total).toBe(2);
    const capped = buildLabReport(
      {
        ...data,
        skipped: Array.from({ length: ENGINE.skippedSignalsCap }, (_, i) =>
          skip(i, "symbol-busy"),
        ),
      },
      { now: NOW },
    ).experiments[0];
    expect(capped.skipped.capped).toBe(true);
    // Лимит — по всей эпохе: после --since строк мало, но в эпохе причина упёрлась в лимит.
    const cappedEpoch = buildLabReport(
      {
        ...data,
        skippedCounts: [
          {
            experimentId: "F04",
            reason: "max-open",
            count: ENGINE.skippedSignalsCap,
          },
        ],
      },
      { now: NOW, since: Date.parse("2026-10-03T00:00:00Z") },
    ).experiments[0];
    expect(cappedEpoch.skipped.total).toBe(2);
    expect(cappedEpoch.skipped.capped).toBe(true);
    expect(
      buildLabReport({ ...data, skippedCounts: [] }, { now: NOW })
        .experiments[0].skipped.capped,
    ).toBe(false);
    const md = renderLabReport(buildLabReport(data, { now: NOW }));
    expect(md).toContain(
      "Отсечённые сигналы: 3 (лимит позиций 2, символ занят 0, нет денег 1).",
    );
    expect(md).toContain("с флагом `--after-exit`");
  });

  it("контроль: все случайные входы рынка вместе, медиана и BTC с тем же удержанием", () => {
    const random2: LabExperiment = {
      ...experiment("S19"),
      id: "PS99",
      name: "Случайный вход (тест)",
    };
    const market: MarketContext = {
      symbol: "BTCUSDT",
      lastPrice: 100,
      periodReturnPct: 10, // 1 % в день за 10 дней
      periodMaxDrawdownPct: 0.01,
      ema200_4h: 90,
      aboveEma200: true,
      adx14_4h: 30,
      atrPct14_4h: 1,
      regime: "trend-up",
      regimeAtStart: "trend-up",
      daily: [],
    };
    const report = buildLabReport(
      dataset(
        [experiment("S04"), experiment("S19"), random2],
        [
          ...[1, 1, 1].map((r) => trade("S04", r)),
          // один хвост у S19 и ровные сделки у второго контроля
          trade("S19", 20),
          trade("S19", -1),
          ...[-1, -1, -1].map((r) => trade("PS99", r)),
        ],
      ),
      { now: NOW, market },
    );
    expect(report.controlBaseline.spot).toEqual({
      experiments: ["S19", "PS99"],
      closed: 5,
      meanPct: 3.2,
      medianPct: -1,
    });
    expect(report.controlBaseline.usdm.experiments).toEqual([]);
    expect(report.controlBaseline.coinm.closed).toBe(0);
    const s04 = report.experiments.find((e) => e.id === "S04");
    expect(s04?.vsRandomPct).toBeCloseTo(1 - 3.2);
    expect(s04?.vsRandomMedianPct).toBeCloseTo(2);
    // 30 мин удержания при дрейфе 1 %/день ≈ +0,0208 %, круг spot 0,2 % + 0,1 % слиппеджа.
    expect(s04?.vsMarketPct).toBeCloseTo(1 - (1 / 48 - 0.3));
    for (const id of ["S19", "PS99"]) {
      const c = report.experiments.find((e) => e.id === id);
      expect(c?.vsRandomPct).toBeNull();
      expect(c?.vsRandomMedianPct).toBeNull();
    }
    expect(renderLabReport(report)).toContain(
      "Случайный вход (все такие эксперименты вместе",
    );
    expect(only("S04", [trade("S04", 1)]).vsMarketPct).toBeNull();
  });

  it("прошлая эпоха: период — до её конца, а не до времени отчёта", () => {
    const endedAt = new Date(START + 4 * 24 * HOUR).toISOString();
    const report = buildLabReport(
      {
        run: {
          id: 1,
          startedAt: new Date(START).toISOString(),
          endedAt,
        },
        experiments: [experiment("S04")],
        trades: [trade("S04", 1), trade("S04", -1)],
      },
      { now: NOW },
    );
    expect(report.run.endedAt).toBe(endedAt);
    expect(report.periodEnd).toBe(endedAt);
    expect(report.periodDays).toBeCloseTo(4);
    expect(report.experiments[0].tradesPerDay).toBeCloseTo(0.5);
    expect(renderLabReport(report)).toContain(
      `по ${endedAt} (прошлая эпоха; конфиг экспериментов — текущий)`,
    );
  });

  it("после выхода и исход отсечённых сигналов — из загруженных свечей ТФ", () => {
    const tf = 15 * 60_000; // S04 — 15m
    const exitAt = START + 2 * HOUR;
    const closes = new Map([
      [exitAt + 4 * tf, 101],
      [exitAt + 12 * tf, 99],
      [exitAt + 24 * tf, 100],
    ]);
    const candles = Array.from({ length: 40 }, (_, i) => {
      const openTime = exitAt + i * tf;
      const close = closes.get(openTime) ?? 100;
      return { openTime, open: 100, high: 100.5, low: 99.5, close, volume: 1 };
    });
    const klines = new Map([["spot:BTCUSDT:15m", candles]]);
    const t = trade("S04", 0, {
      openedAt: new Date(exitAt - 30 * 60_000).toISOString(),
      closedAt: new Date(exitAt + 60_000).toISOString(),
      exitPrice: 100,
    });
    const report = buildLabReport(
      {
        ...dataset([experiment("S04")], [t]),
        skipped: [
          {
            id: "s1",
            runId: 1,
            experimentId: "S04",
            market: "spot",
            symbol: "BTCUSDT",
            direction: "long",
            bar: exitAt - tf,
            at: new Date(exitAt).toISOString(),
            reason: "max-open",
            entryPrice: 100,
            stop: 99,
            takeProfit: 102,
          },
        ],
      },
      { now: NOW, klines },
    );
    const [s04] = report.experiments;
    expect(report.klinesLoaded).toBe(true);
    const all = s04.afterExit?.filter((r) => r.reason === "все") ?? [];
    expect(all.map((r) => r.bars)).toEqual([4, 12, 24]);
    expect(all.map((r) => r.avgMovePct?.toFixed(6))).toEqual([
      "1.000000",
      "-1.000000",
      "0.000000",
    ]);
    expect(all.map((r) => r.avgMoveR?.toFixed(6))).toEqual([
      "1.000000",
      "-1.000000",
      "0.000000",
    ]);
    expect(all.map((r) => r.continuedShare)).toEqual([1, 0, 0]);
    // Свечи ±0,5 не задели ни стоп 99, ни тейк 102: «не закрылся» по close конца горизонта.
    expect(s04.skipped.outcome).toMatchObject({ n: 1, tp: 0, sl: 0, open: 1 });
    const md = renderLabReport(report);
    expect(md).toContain("**После выхода**");
    expect(md).toContain("Грубый исход по свечам ТФ");
  });
});

describe("открытые позиции по последней цене (баг 0041)", () => {
  /** Открытая long-сделка: вход 100, 0,5 шт., стоп 99 (1R = 0,5 $). */
  const open = (
    experimentId: string,
    over: Partial<PaperTrade> = {},
  ): PaperTrade =>
    trade(experimentId, 0, {
      closedAt: null,
      exitPrice: null,
      exitReason: null,
      pnl: null,
      rMultiple: null,
      ...over,
    });
  // Spot, выход по рынку 110 × (1 − 0,05 %) = 109,945; комиссии 0,1 % × 0,5 × (100 + 109,945).
  const exit110 = 110 * (1 - 0.0005);
  const pnl110 = (exit110 - 100) * 0.5 - 0.001 * 0.5 * (100 + exit110);

  it("PnL и R как при закрытии по рынку: слиппедж выхода, комиссии обеих сторон; без цены — не оценена", () => {
    const u = unrealizedStats(
      [
        open("S04", { openedAt: new Date(START).toISOString() }),
        open("S04", { initialStop: null, symbol: "ETHUSDT" }),
        open("S04", { symbol: "NOPRICEUSDT" }),
      ],
      { "spot:BTCUSDT": 110, "spot:ETHUSDT": 110 },
      NOW,
    );
    expect(u.open).toBe(3);
    expect(u.priced).toBe(2);
    expect(u.pnl).toBeCloseTo(2 * pnl110, 10);
    expect(u.withStop).toBe(1);
    expect(u.sumR).toBeCloseTo(pnl110 / 0.5, 10);
    expect(u.maxAgeDays).toBeCloseTo(10, 10);
  });

  it("short: рост цены — убыток; нет цен — открытые считаются, но не оцениваются", () => {
    const short = open("F04", { direction: "short", initialStop: 101 });
    const u = unrealizedStats([short], { "usdm:BTCUSDT": 105 }, NOW);
    const exit = 105 * (1 + 0.0005);
    expect(u.pnl).toBeCloseTo(
      (100 - exit) * 0.5 - 0.0005 * 0.5 * (100 + exit),
      10,
    );
    expect(unrealizedStats([short], null, NOW)).toMatchObject({
      open: 1,
      priced: 0,
      pnl: null,
      sumR: null,
    });
    expect(unrealizedStats([], null, NOW)).toEqual({
      open: 0,
      priced: 0,
      pnl: null,
      sumR: null,
      withStop: 0,
      maxAgeDays: null,
    });
  });

  it("отчёт: открытые всей эпохи (без учёта --since) в unrealized и сводке; метрики закрытых не меняются", () => {
    const closed = [2, -1].map((r) => trade("S04", r));
    const data = dataset(
      [experiment("S04")],
      [...closed, open("S04", { openedAt: new Date(START).toISOString() })],
    );
    const since = Date.parse("2026-10-05T00:00:00Z");
    const without = buildLabReport(data, { now: NOW });
    const report = buildLabReport(data, {
      now: NOW,
      openPricing: {
        prices: { "spot:BTCUSDT": 110 },
        source: "тест",
        at: "2026-10-11T00:00:00.000Z",
      },
    });
    const [s04] = report.experiments;
    expect(report.openPricing).toEqual({
      source: "тест",
      at: "2026-10-11T00:00:00.000Z",
    });
    expect(s04.unrealized).toMatchObject({ open: 1, priced: 1 });
    expect(s04.unrealized.pnl).toBeCloseTo(pnl110, 10);
    const { unrealized: _a, ...rest } = s04;
    const { unrealized: _b, ...restWithout } = without.experiments[0];
    expect(rest).toEqual(restWithout);
    expect(without.openPricing).toBeNull();
    expect(without.experiments[0].unrealized).toMatchObject({
      open: 1,
      pnl: null,
    });
    // --since отрезает открытую по времени входа, но на конец периода она всё равно открыта.
    expect(
      buildLabReport(data, { now: NOW, since }).experiments[0].unrealized.open,
    ).toBe(1);
    expect(report.legend).toContain("unrealized");

    const md = renderLabReport(report);
    expect(md).toContain("| Откр. | Нереализ. R / $ |");
    expect(md).toContain(
      `| 1 | ${(pnl110 / 0.5).toFixed(2)} / +${pnl110.toFixed(2)} |`,
    );
    expect(md).toContain("Открытые позиции оценены по последней цене (тест");
    expect(md).toContain(
      `Открыто на конец периода: 1, старейшая — 10.0 дн. Если закрыть по рынку сейчас: +${pnl110.toFixed(2)} $, сумма ${(pnl110 / 0.5).toFixed(2)}R (со стопом 1).`,
    );
    expect(renderLabReport(without)).toContain(
      "Открытые позиции по последней цене не оценены.",
    );
  });
});
