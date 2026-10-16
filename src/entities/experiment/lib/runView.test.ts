import { describe, expect, it } from "vitest";
import { describeRunView, runEnd, toRunParam } from "./runView";

const runs = [
  { id: 3, startedAt: "2026-10-15T00:00:00.000Z" },
  { id: 2, startedAt: "2026-10-12T00:00:00.000Z" },
  { id: 1, startedAt: "2026-10-10T00:00:00.000Z" },
];

describe("период страниц лаборатории", () => {
  it("конец эпохи — начало следующей, у текущей нет", () => {
    expect(runEnd(runs, 3)).toBeNull();
    expect(runEnd(runs, 2)).toBe("2026-10-15T00:00:00.000Z");
    expect(runEnd(runs, 9)).toBeNull();
  });

  it("текущая эпоха в URL не пишется", () => {
    expect(toRunParam(runs, 3)).toBeNull();
    expect(toRunParam(runs, 1)).toBe(1);
    expect(toRunParam(runs, "all")).toBe("all");
  });

  it("подпись: текущая, прошлая с концом, все эпохи с началом первой", () => {
    expect(describeRunView({ scope: 3, run: runs[0], runs })).toMatch(
      /^Эпоха №3 \(текущая\) с /,
    );
    expect(describeRunView({ scope: 2, run: runs[1], runs })).toMatch(
      /^Эпоха №2: .+ — .+$/,
    );
    expect(describeRunView({ scope: "all", run: runs[0], runs })).toMatch(
      /^Все эпохи с .+ \(3\)$/,
    );
  });
});
