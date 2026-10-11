import { describe, expect, it } from "vitest";
import { computeStats, type ExperimentSummary } from "@/entities/experiment";
import { sortExperiments } from "./sortExperiments";

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
  demo: {
    trades: 0,
    open: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    rejected: 0,
    pnl: 0,
  },
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
  summary("F01", "futures", [50]),
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

  it("profit factor без убытков считается бесконечным", () => {
    expect(sortExperiments(list, "all", "profitFactor", "desc")[0].id).toBe(
      "F01",
    );
  });

  it("демо-счёт: сначала торгующие на демо; PnL демо без закрытых — в конце", () => {
    const a = { ...summary("S01", "spot", []), demoMirror: true };
    const b = {
      ...summary("S02", "spot", []),
      demo: {
        trades: 3,
        open: 1,
        closed: 2,
        wins: 0,
        losses: 2,
        rejected: 0,
        pnl: -4,
      },
    };
    const c = {
      ...summary("S03", "spot", []),
      demo: {
        trades: 1,
        open: 0,
        closed: 1,
        wins: 1,
        losses: 0,
        rejected: 0,
        pnl: 2,
      },
    };
    expect(
      sortExperiments([b, c, a], "all", "demo", "desc").map((e) => e.id),
    ).toEqual(["S01", "S02", "S03"]);
    expect(
      sortExperiments([a, b, c], "all", "demoPnl", "desc").map((e) => e.id),
    ).toEqual(["S03", "S02", "S01"]);
  });
});
