import { describe, expect, it } from "vitest";
import { computeStats, type StatsGroupView } from "@/entities/experiment";
import { sortGroups } from "./sortGroups";

const group = (label: string, pnls: number[]): StatsGroupView => ({
  key: label,
  label,
  stats: computeStats(
    pnls.map((pnl, i) => ({
      openedAt: "2026-10-10T00:00:00Z",
      closedAt: `2026-10-10T0${i + 1}:00:00Z`,
      pnl,
      fees: 1,
      rMultiple: null,
    })),
    0,
  ),
});

const GROUPS = [
  group("BBB", [10, -5]),
  group("AAA", [3]),
  group("CCC", []),
  group("DDD", [-20]),
];

describe("sortGroups", () => {
  it("по PnL по убыванию и возрастанию", () => {
    expect(sortGroups(GROUPS, "pnl", "desc").map((g) => g.label)).toEqual([
      "BBB",
      "AAA",
      "CCC",
      "DDD",
    ]);
    expect(sortGroups(GROUPS, "pnl", "asc").map((g) => g.label)).toEqual([
      "DDD",
      "CCC",
      "AAA",
      "BBB",
    ]);
  });

  it("без данных — в конце при любом направлении; ∞ profit factor — лучший", () => {
    expect(sortGroups(GROUPS, "winRate", "asc").map((g) => g.label)).toEqual([
      "DDD",
      "BBB",
      "AAA",
      "CCC",
    ]);
    expect(
      sortGroups(GROUPS, "profitFactor", "desc").map((g) => g.label),
    ).toEqual(["AAA", "BBB", "DDD", "CCC"]);
  });

  it("по названию группы", () => {
    expect(sortGroups(GROUPS, "key", "asc").map((g) => g.label)).toEqual([
      "AAA",
      "BBB",
      "CCC",
      "DDD",
    ]);
  });
});
