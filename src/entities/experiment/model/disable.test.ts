import { describe, expect, it } from "vitest";
import { DISABLE_REASONS, toDisabledInfo } from "./disable";

describe("причина выключения", () => {
  it("категории — как в spec 0046", () => {
    expect(Object.keys(DISABLE_REASONS)).toEqual([
      "loser",
      "worse-than-control",
      "duplicate",
      "random-like",
      "no-edge",
      "costs",
      "manual",
    ]);
  });

  it("включённый — null; выключенный до spec 0046 или с незнакомой категорией — без категории", () => {
    const row = {
      enabled: false,
      disabledReason: "loser",
      disabledNote: "минус",
      disabledAt: new Date("2026-10-16T10:00:00Z"),
    };
    expect(toDisabledInfo({ ...row, enabled: true })).toBeNull();
    expect(toDisabledInfo(row)).toEqual({
      reason: "loser",
      note: "минус",
      at: "2026-10-16T10:00:00.000Z",
    });
    expect(
      toDisabledInfo({
        enabled: false,
        disabledReason: "что-то",
        disabledNote: null,
        disabledAt: null,
      }),
    ).toEqual({ reason: null, note: null, at: null });
  });
});
