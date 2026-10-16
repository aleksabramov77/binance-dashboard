import { describe, expect, it } from "vitest";
import {
  computeLiveStats,
  computeStats,
  type DemoSummary,
  type ExperimentSummary,
  emptyLiveSummary,
} from "@/entities/experiment";
import type { SortDir } from "@/shared/lib";
import type { MarketFilter } from "../model/useExperimentsView";
import {
  arrangeVariants,
  type ExperimentRowView,
  hideCollapsed,
  isGroupedSort,
  SORT_KEYS,
  type SortKey,
  sortExperiments,
} from "./sortExperiments";

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
  liveMirror: false,
  liveMirrorMode: "off",
  liveThresholds: { lossUsd: 15, streak: 5 },
  liveAuto: null,
  liveAutoOff: null,
  parentId: null,
  variantNote: null,
  disabled: null,
  demoMirrorMode: "auto",
  demoMirrorAuto: null,
  demo: demo(),
  live: emptyLiveSummary(),
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

  it("без закрытых сделок (в ячейке «—») — в конце при любом направлении, а не между плюсом и минусом", () => {
    const rows = [
      summary("F96", "usdm", []),
      summary("F97", "usdm", [20]),
      summary("F98", "usdm", [-8]),
    ];
    expect(
      sortExperiments(rows, "all", "pnl", "desc").map((e) => e.id),
    ).toEqual(["F97", "F98", "F96"]);
    expect(sortExperiments(rows, "all", "pnl", "asc").map((e) => e.id)).toEqual(
      ["F98", "F97", "F96"],
    );
    for (const key of [
      "winRate",
      "pnl",
      "profitFactor",
      "maxDrawdown",
    ] as const)
      for (const dir of ["asc", "desc"] as const)
        expect(
          sortExperiments(rows, "all", key, dir).at(-1)?.id,
          `${key} ${dir}`,
        ).toBe("F96");
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

  it("реальный счёт: по убыванию — торгующие, потом «Авто» и «Вкл + автовыкл» без торговли, потом «Выкл» (spec 0053)", () => {
    const rows = [
      summary("S96", "usdm", []),
      { ...summary("S97", "usdm", []), liveMirrorMode: "auto" as const },
      {
        ...summary("S98", "usdm", []),
        liveMirrorMode: "on" as const,
        liveMirror: true,
      },
    ];
    expect(
      sortExperiments(rows, "all", "live", "desc").map((e) => e.id),
    ).toEqual(["S98", "S97", "S96"]);
  });

  it("Real-метрики (spec 0054): PnL, PF, Max DD и Equity в $; без закрытых с PnL и COIN-M — в конце в обе стороны", () => {
    const real = (id: string, pnls: (number | null)[], open = 0) => ({
      ...summary(id, "usdm", []),
      live: computeLiveStats([
        ...pnls.map((realizedPnl, i) => ({
          status: "closed" as const,
          realizedPnl,
          pnlEstimated: false,
          closedAt: `2026-10-12T0${i + 1}:00:00Z`,
        })),
        ...Array.from({ length: open }, () => ({
          status: "protected" as const,
          realizedPnl: null,
          pnlEstimated: false,
          closedAt: null,
        })),
      ]),
    });
    const none = real("S95", [], 1);
    const unknown = real("S96", [null]);
    const low = real("S97", [2, -3]);
    const high = real("S98", [1, 0.84]);
    const coinm = { ...real("PS99", [5]), market: "coinm" as const };
    const rows = [none, unknown, low, high, coinm];
    expect(
      sortExperiments(rows, "all", "livePnl", "desc").map((e) => e.id),
    ).toEqual(["S98", "S97", "PS99", "S95", "S96"]);
    expect(sortExperiments(rows, "all", "liveProfitFactor", "desc")[0].id).toBe(
      "S98",
    );
    expect(sortExperiments(rows, "all", "liveMaxDrawdown", "desc")[0].id).toBe(
      "S97",
    );
    for (const dir of ["asc", "desc"] as const)
      for (const key of [
        "livePnl",
        "liveEquity",
        "liveMaxDrawdown",
        "liveProfitFactor",
      ] as const)
        expect(
          sortExperiments(rows, "all", key, dir)
            .slice(-3)
            .map((e) => e.id)
            .sort(),
        ).toEqual(["PS99", "S95", "S96"]);
    expect(
      sortExperiments(rows, "all", "liveTrades", "desc").map((e) => e.id),
    ).toEqual(["S97", "S98", "S95", "S96", "PS99"]);
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

describe("раскладка строк: группы вариантов и плоский вид (spec 0046, 0052)", () => {
  // Смешанный список: контрольный F96, его варианты F97 (usdm) и PS99 (spot), обычный F01 и F98 — вариант
  // контрольного, которого нет в БД. Id фиктивные.
  const family = [
    summary("F96", "usdm", [5]),
    {
      ...summary("F97", "usdm", [50]),
      parentId: "F96",
      variantNote: "цель 3R",
    },
    { ...summary("PS99", "spot", [-20]), parentId: "F96", variantNote: "spot" },
    summary("F01", "usdm", [10]),
    { ...summary("F98", "usdm", [1]), parentId: "F90" },
  ];
  /** Раскладка, как на странице: сортировка → вид по колонке → свёрнутые. */
  const layout = (
    key: SortKey,
    dir: SortDir,
    {
      market = "all",
      collapsed = [],
    }: { market?: MarketFilter; collapsed?: string[] } = {},
  ) =>
    hideCollapsed(
      arrangeVariants(
        sortExperiments(family, market, key, dir),
        family,
        isGroupedSort(key),
      ),
      new Set(collapsed),
    );
  const view = (rows: ExperimentRowView[]) =>
    rows.map((r) => [r.e.id, r.variantOf, r.letter, r.nested, r.variants]);
  const ids = (rows: ExperimentRowView[]) => rows.map((r) => r.e.id);

  it("групповой вид — только при сортировке по «Эксперимент»", () => {
    expect(SORT_KEYS.filter(isGroupedSort)).toEqual(["id"]);
  });

  it("сортировка по «Эксперимент»: варианты под контрольным в том же порядке, шеврон у контрольного", () => {
    expect(view(layout("id", "asc"))).toEqual([
      ["F01", null, null, false, 0],
      ["F96", null, null, false, 2],
      ["F97", "F96", "A", true, 0],
      ["PS99", "F96", "B", true, 0],
      ["F98", null, null, false, 0],
    ]);
    expect(ids(layout("id", "desc"))).toEqual([
      "F98",
      "F96",
      "PS99",
      "F97",
      "F01",
    ]);
  });

  it("сортировка по PnL: плоский порядок строго по значению, варианты не прижаты к контрольному", () => {
    const rows = layout("pnl", "desc");
    expect(ids(rows)).toEqual(["F97", "F01", "F96", "F98", "PS99"]);
    const pnl = rows.map((r) => r.e.stats.realizedPnl);
    expect(pnl).toEqual([...pnl].sort((a, b) => b - a));
    expect(ids(layout("pnl", "asc"))).toEqual([
      "PS99",
      "F98",
      "F96",
      "F01",
      "F97",
    ]);
  });

  it("любая колонка, кроме «Эксперимент», не переставляет строки отсортированного списка", () => {
    for (const key of SORT_KEYS.filter((k) => k !== "id"))
      for (const dir of ["asc", "desc"] as const)
        expect(ids(layout(key, dir)), `${key} ${dir}`).toEqual(
          sortExperiments(family, "all", key, dir).map((e) => e.id),
        );
  });

  it("плоский вид: у варианта — контрольный и буква как в групповом, без вложенности и шеврона", () => {
    expect(view(layout("pnl", "desc"))).toEqual([
      ["F97", "F96", "A", false, 0],
      ["F01", null, null, false, 0],
      ["F96", null, null, false, 0],
      // Контрольного нет в БД — ни метки, ни буквы.
      ["F98", null, null, false, 0],
      ["PS99", "F96", "B", false, 0],
    ]);
  });

  it("свёрнутый контрольный прячет варианты только в групповом виде", () => {
    expect(view(layout("id", "asc", { collapsed: ["F96"] }))).toEqual([
      ["F01", null, null, false, 0],
      ["F96", null, null, false, 2],
      ["F98", null, null, false, 0],
    ]);
    expect(ids(layout("pnl", "desc", { collapsed: ["F96"] }))).toEqual([
      "F97",
      "F01",
      "F96",
      "F98",
      "PS99",
    ]);
  });

  it("контрольный скрыт фильтром AG — вариант обычной строкой с меткой в обоих видах", () => {
    for (const key of ["id", "pnl"] as const)
      expect(view(layout(key, "desc", { market: "spot" })), key).toEqual([
        ["PS99", "F96", "B", false, 0],
      ]);
  });
});
