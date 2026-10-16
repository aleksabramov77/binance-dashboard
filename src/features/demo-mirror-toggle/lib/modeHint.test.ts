import { describe, expect, it } from "vitest";
import { MODE_MEANING, mirrorModeHint } from "./modeHint";

describe("mirrorModeHint", () => {
  it("«Авто»: смысл, последнее изменение и последняя проверка автомата", () => {
    const hint = mirrorModeHint("auto", {
      checkedAt: "2026-10-17T07:00:00.000Z",
      check: { decision: "keep", demoMirror: true, trades: 0, avgR: null },
      change: {
        at: "2026-10-16T07:00:00.000Z",
        decision: "enable",
        demoMirror: true,
        trades: 32,
        avgR: 0.2,
      },
    });
    expect(hint).toContain(MODE_MEANING.auto);
    expect(hint).toMatch(
      /Последнее изменение \(.+\): включил: 32 сделки, средний R \+0\.20\./,
    );
    expect(hint).toMatch(
      /Последняя проверка \(.+\): оставил включённым: сделок с R ещё нет\./,
    );
  });

  it("«Авто» без решений — «ещё не решал»; изменений не было — так и пишет", () => {
    expect(mirrorModeHint("auto", null)).toContain("Автомат ещё не решал.");
    expect(
      mirrorModeHint("auto", {
        checkedAt: "2026-10-17T07:00:00.000Z",
        check: { decision: "keep", demoMirror: false, trades: 12, avgR: 0.05 },
        change: null,
      }),
    ).toContain("Автомат ещё не менял зеркало.");
  });

  it("ручные положения — только смысл", () => {
    expect(mirrorModeHint("on", null)).toBe(MODE_MEANING.on);
    expect(mirrorModeHint("off", null)).toBe(MODE_MEANING.off);
  });
});
