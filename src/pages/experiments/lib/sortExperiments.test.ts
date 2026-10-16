import { describe, expect, it } from "vitest";
import {
  computeStats,
  type DemoSummary,
  type ExperimentSummary,
} from "@/entities/experiment";
import { arrangeVariants, sortExperiments } from "./sortExperiments";

/** Демо-сводка: по умолчанию демо-сделок нет. */
const demo = (d: Partial<DemoSummary> = {}): DemoSummary => ({
  trades: 0,
  open: 0,
  closed: 0,
  wins: 0,
  losses: 0,
  rejected: 0,
  skipped: 0,
  pnl: 0,
  grossProfit: 0,
  profitFactor: null,
  maxDrawdownPct: 0,
  equity: 1000,
  ...d,
});

const summary = (
  id: string,
  market: ExperimentSummary["market"],
  pnls: number[],
): ExperimentSummary => ({
  id,
  market,
  name: id,
  hypothesis: "",
  initialBudget: 1000,
  enabled: true,
  demoMirror: false,
  parentId: null,
  variantNote: null,
  disabled: null,
  demoMirrorMode: "auto",
  demoMirrorAuto: null,
  demo: demo(),
  stats: computeStats(
    pnls.map((pnl, i) => ({
      openedAt: "2026-10-10T00:00:00Z",
      closedAt: `2026-10-10T0${i + 1}:00:00Z`,
      pnl,
      fees: 0,
      rMultiple: null,
    })),
    1000,
  ),
});

const list = [
  summary("S02", "spot", [10, -5]),
  summary("F01", "usdm", [50]),
  summary("S01", "spot", []),
];

describe("sortExperiments", () => {
  it("фильтрует по рынку", () => {
    expect(sortExperiments(list, "spot", "id", "asc").map((e) => e.id)).toEqual(
      ["S01", "S02"],
    );
  });

  it("сортирует по PnL по убыванию", () => {
    expect(
      sortExperiments(list, "all", "pnl", "desc").map((e) => e.id),
    ).toEqual(["F01", "S02", "S01"]);
  });

  it("пустые значения (нет закрытых сделок) — в конце при любом направлении", () => {
    for (const dir of ["asc", "desc"] as const)
      expect(
        sortExperiments(list, "all", "winRate", dir)
          .map((e) => e.id)
          .at(-1),
      ).toBe("S01");
  });

  it("вкл: по убыванию сначала включённые, при равенстве — по id", () => {
    const rows = [
      { ...summary("S03", "spot", []), enabled: false },
      summary("S02", "spot", []),
      { ...summary("S01", "spot", []), enabled: false },
      summary("F01", "usdm", []),
    ];
    expect(
      sortExperiments(rows, "all", "enabled", "desc").map((e) => e.id),
    ).toEqual(["F01", "S02", "S01", "S03"]);
    expect(
      sortExperiments(rows, "all", "enabled", "asc").map((e) => e.id),
    ).toEqual(["S01", "S03", "F01", "S02"]);
  });

  it("ag: spot раньше usdm по возрастанию, при равенстве — по id", () => {
    const groups = [
      summary("F02", "usdm", []),
      summary("S03", "spot", []),
      summary("F01", "usdm", []),
    ];
    expect(
      sortExperiments(groups, "all", "ag", "asc").map((e) => e.id),
    ).toEqual(["S03", "F01", "F02"]);
    expect(
      sortExperiments(groups, "all", "ag", "desc").map((e) => e.id),
    ).toEqual(["F01", "F02", "S03"]);
  });

  it("демо-метрики: без демо-сделок — в конце в обе стороны; PF без убытков — бесконечный", () => {
    const none = summary("S01", "spot", []);
    const low = {
      ...summary("S02", "spot", []),
      demo: demo({
        closed: 2,
        grossProfit: 5,
        profitFactor: 0.5,
        equity: 990,
        maxDrawdownPct: 0.02,
      }),
    };
    const high = {
      ...summary("S03", "spot", []),
      demo: demo({
        closed: 1,
        grossProfit: 3,
        profitFactor: null,
        equity: 1003,
      }),
    };
    for (const dir of ["asc", "desc"] as const) {
      expect(
        sortExperiments([none, low, high], "all", "demoEquity", dir).at(-1)?.id,
      ).toBe("S01");
      expect(
        sortExperiments([none, low, high], "all", "demoMaxDrawdown", dir).at(-1)
          ?.id,
      ).toBe("S01");
    }
    expect(
      sortExperiments([none, low, high], "all", "demoEquity", "desc").map(
        (e) => e.id,
      ),
    ).toEqual(["S03", "S02", "S01"]);
    expect(
      sortExperiments([low, none, high], "all", "demoProfitFactor", "desc").map(
        (e) => e.id,
      ),
    ).toEqual(["S03", "S02", "S01"]);
  });

  it("profit factor без убытков считается бесконечным", () => {
    expect(sortExperiments(list, "all", "profitFactor", "desc")[0].id).toBe(
      "F01",
    );
  });

  it("демо-счёт: сначала торгующие на демо; PnL демо без закрытых — в конце", () => {
    const a = { ...summary("S01", "spot", []), demoMirror: true };
    const b = {
      ...summary("S02", "spot", []),
      demo: demo({ trades: 3, open: 1, closed: 2, losses: 2, pnl: -4 }),
    };
    const c = {
      ...summary("S03", "spot", []),
      demo: demo({ trades: 1, closed: 1, wins: 1, pnl: 2 }),
    };
    expect(
      sortExperiments([b, c, a], "all", "demo", "desc").map((e) => e.id),
    ).toEqual(["S01", "S02", "S03"]);
    expect(
      sortExperiments([a, b, c], "all", "demoPnl", "desc").map((e) => e.id),
    ).toEqual(["S03", "S02", "S01"]);
  });
});

describe("arrangeVariants (spec 0046)", () => {
  // Контрольный F96 и варианты F97 (usdm) и PS99 (spot) — фиктивные id.
  const family = [
    summary("F96", "usdm", [5]),
    {
      ...summary("F97", "usdm", [50]),
      parentId: "F96",
      variantNote: "цель 3R",
    },
    { ...summary("PS99", "spot", [-20]), parentId: "F96", variantNote: "spot" },
    summary("F01", "usdm", [10]),
    // Контрольного нет в БД — обычная строка.
    { ...summary("F98", "usdm", [1]), parentId: "F90" },
  ];
  const view = (rows: ReturnType<typeof arrangeVariants>) =>
    rows.map((r) => [r.e.id, r.variantOf, r.letter, r.variants]);

  it("варианты под контрольным, группы — по строке контрольного, внутри — тем же столбцом", () => {
    const sorted = sortExperiments(family, "all", "pnl", "desc");
    expect(sorted.map((e) => e.id)).toEqual([
      "F97",
      "F01",
      "F96",
      "F98",
      "PS99",
    ]);
    expect(view(arrangeVariants(sorted, family))).toEqual([
      ["F01", null, null, 0],
      ["F96", null, null, 2],
      ["F97", "F96", "A", 0],
      ["PS99", "F96", "B", 0],
      ["F98", null, null, 0],
    ]);
    const asc = sortExperiments(family, "all", "pnl", "asc");
    expect(view(arrangeVariants(asc, family)).map((r) => r[0])).toEqual([
      "F98",
      "F96",
      "PS99",
      "F97",
      "F01",
    ]);
  });

  it("контрольного нет под фильтром AG — вариант обычной строкой, буква не теряется у остальных", () => {
    const spot = sortExperiments(family, "spot", "id", "asc");
    expect(view(arrangeVariants(spot, family))).toEqual([
      ["PS99", null, null, 0],
    ]);
  });
});
