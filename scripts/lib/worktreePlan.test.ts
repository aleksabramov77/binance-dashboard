import { describe, expect, it } from "vitest";
import {
  BRANCH_PATTERN,
  DEFAULT_LINKS,
  latestPrByBranch,
  nextTaskNumber,
  normalizeLinks,
  type PruneInput,
  parseDuration,
  parseWorktreeList,
  planPrune,
  usedTaskNumbers,
  worktreeFolderName,
} from "./worktreePlan";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-15T12:00:00Z");

describe("parseWorktreeList", () => {
  it("первая запись — основной checkout, ветки без refs/heads, detached и bare", () => {
    const porcelain = [
      "worktree /p/binance-dashboard",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /p/binance-dashboard_012-sort",
      "HEAD bbb",
      "branch refs/heads/feature/0012-sort",
      "",
      "worktree /p/binance-dashboard_probe",
      "HEAD ccc",
      "detached",
      "",
    ].join("\n");
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/p/binance-dashboard", branch: "main", main: true },
      {
        path: "/p/binance-dashboard_012-sort",
        branch: "feature/0012-sort",
        main: false,
      },
      { path: "/p/binance-dashboard_probe", branch: null, main: false },
    ]);
  });
});

describe("normalizeLinks", () => {
  it("строка — ссылка, объект с copy — копия; повторы и пути наружу отбрасываются", () => {
    expect(
      normalizeLinks(
        [
          ".env.local",
          { path: "public/config.json", mode: "copy" },
          "../x",
          "/abs",
        ],
        ["./.env.local", "docs/"],
        "не массив",
      ),
    ).toEqual([
      { path: ".env.local", mode: "link" },
      { path: "public/config.json", mode: "copy" },
      { path: "docs", mode: "link" },
    ]);
  });
});

describe("DEFAULT_LINKS", () => {
  it("worktree получает ссылки на .env.local и папку private основного checkout", () => {
    expect(normalizeLinks(DEFAULT_LINKS)).toEqual([
      { path: ".env.local", mode: "link" },
      { path: "private", mode: "link" },
    ]);
  });
});

describe("parseDuration", () => {
  it("минуты, часы, дни; мусор — null", () => {
    expect(parseDuration("90m")).toBe(90 * 60_000);
    expect(parseDuration("24h")).toBe(DAY);
    expect(parseDuration("3d")).toBe(3 * DAY);
    expect(parseDuration("сутки")).toBeNull();
  });
});

describe("worktreeFolderName и BRANCH_PATTERN", () => {
  it("метка — последний сегмент ветки или своя", () => {
    expect(
      worktreeFolderName("binance-dashboard", "feature/0012-sort-memory"),
    ).toBe("binance-dashboard_0012-sort-memory");
    expect(
      worktreeFolderName("binance-dashboard", "chore/flows", "Flow Skill"),
    ).toBe("binance-dashboard_flow-skill");
  });

  it("новая ветка — <тип>/NNNN-slug по соглашению проекта", () => {
    expect(BRANCH_PATTERN.test("feature/0012-sort-memory")).toBe(true);
    expect(BRANCH_PATTERN.test("bug/0009-table-sort-restore")).toBe(true);
    expect(BRANCH_PATTERN.test("hotfix/0013-mirror")).toBe(true);
    expect(BRANCH_PATTERN.test("chore/0011-flows")).toBe(true);
    expect(BRANCH_PATTERN.test("feat/012-sort-memory")).toBe(false);
    expect(BRANCH_PATTERN.test("fix/mirror")).toBe(false);
    expect(BRANCH_PATTERN.test("feature/012-sort")).toBe(false);
    expect(BRANCH_PATTERN.test("feature/0012-Sort")).toBe(false);
    expect(BRANCH_PATTERN.test("main")).toBe(false);
  });
});

describe("номер задачи", () => {
  const history = [
    "| № | Дата | Тип | Задача | Spec | PR | Статус |",
    "| 0009 | 2026-10-15 | bug | Сортировка | [009](specs/009-x.md) | — | в работе |",
    "| 0010 | 2026-10-15 | chore | Нумерация | — | #46 | ✅ |",
    "",
    "| Дата | PR | Что сделано |",
    "| 2026-10-11 | #41 | Раздельные сбросы |",
  ].join("\n");

  it("следующий — после последнего в журнале, даты архива не считаются номерами", () => {
    expect(nextTaskNumber(usedTaskNumbers(history, ["main"]))).toBe("0011");
  });

  it("номера ещё не влитых веток, локальных и на GitHub, заняты", () => {
    const used = usedTaskNumbers(history, [
      "main",
      "origin/feature/0012-chart",
      "bug/0013-sort",
      "fix/009-table-sort-restore",
      "origin/chore/flows",
    ]);
    expect([...used].sort((a, b) => a - b)).toEqual([9, 10, 12, 13]);
    expect(nextTaskNumber(used)).toBe("0014");
  });

  it("пустой журнал — 0001", () => {
    expect(nextTaskNumber(usedTaskNumbers("", []))).toBe("0001");
  });
});

describe("latestPrByBranch", () => {
  it("на ветку — PR с наибольшим номером", () => {
    const map = latestPrByBranch([
      {
        headRefName: "feature/0001-a",
        number: 10,
        state: "CLOSED",
        mergedAt: null,
        closedAt: "x",
      },
      {
        headRefName: "feature/0001-a",
        number: 12,
        state: "MERGED",
        mergedAt: "y",
        closedAt: "y",
      },
      {
        headRefName: "feature/0002-b",
        number: 11,
        state: "OPEN",
        mergedAt: null,
        closedAt: null,
      },
    ]);
    expect(map.get("feature/0001-a")?.number).toBe(12);
    expect(map.get("feature/0002-b")?.state).toBe("OPEN");
  });
});

describe("planPrune", () => {
  const base: PruneInput = {
    branch: "feature/0012-sort",
    dirty: false,
    unpushed: 0,
    current: false,
    pr: null,
    lastCommitAt: NOW - DAY,
    now: NOW,
    olderThanMs: DAY,
    staleMs: 14 * DAY,
  };
  const merged = (daysAgo: number) => ({
    number: 46,
    state: "MERGED" as const,
    mergedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    closedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  });

  it("PR влит давно, всё запушено и закоммичено — удалить", () => {
    expect(planPrune({ ...base, pr: merged(3) })).toEqual({
      action: "remove",
      reason: "PR #46 влит 3 дн. назад",
    });
  });

  it("влит недавно — молча оставить (идёт выкатка)", () => {
    expect(planPrune({ ...base, pr: merged(0.1) })).toMatchObject({
      action: "keep",
      attention: false,
    });
  });

  it("влит давно, но есть изменения или незапушенные коммиты — оставить и сказать", () => {
    expect(planPrune({ ...base, pr: merged(3), dirty: true })).toMatchObject({
      action: "keep",
      attention: true,
    });
    expect(planPrune({ ...base, pr: merged(3), unpushed: 2 })).toMatchObject({
      action: "keep",
      attention: true,
    });
  });

  it("текущий worktree, открытый PR — не трогать молча", () => {
    expect(planPrune({ ...base, pr: merged(3), current: true })).toMatchObject({
      action: "keep",
      attention: false,
    });
    expect(
      planPrune({
        ...base,
        pr: { number: 47, state: "OPEN", mergedAt: null, closedAt: null },
      }),
    ).toMatchObject({ action: "keep", attention: false });
  });

  it("закрыт без мержа, detached, давно без PR — оставить и сказать", () => {
    expect(
      planPrune({
        ...base,
        pr: { number: 48, state: "CLOSED", mergedAt: null, closedAt: "x" },
      }),
    ).toMatchObject({ action: "keep", attention: true });
    expect(planPrune({ ...base, branch: null })).toMatchObject({
      action: "keep",
      attention: true,
    });
    expect(planPrune({ ...base, lastCommitAt: NOW - 20 * DAY })).toMatchObject({
      action: "keep",
      attention: true,
    });
    expect(planPrune(base)).toMatchObject({ action: "keep", attention: false });
  });
});
