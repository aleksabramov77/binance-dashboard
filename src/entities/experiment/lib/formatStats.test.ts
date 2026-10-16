import { describe, expect, it } from "vitest";
import { formatRate, liveEstimateHint } from "./formatStats";

describe("formatRate", () => {
  it("нулевая и исчезающе малая просадка — «0 %», без минуса", () => {
    expect(formatRate(-0)).toBe(formatRate(0));
    expect(formatRate(-0.0001)).toBe(formatRate(0));
    expect(formatRate(-0.0001)).not.toMatch(/^[-−]/);
  });
  it("заметные значения — со знаком, null — прочерк", () => {
    expect(formatRate(-0.05)).toMatch(/^[-−]5/);
    expect(formatRate(0.5)).toMatch(/^50/);
    expect(formatRate(null)).toBe("—");
  });
});

describe("liveEstimateHint", () => {
  it("всё по исполнениям — подсказки нет", () => {
    expect(liveEstimateHint({ estimated: 0, unknown: 0 })).toBeNull();
  });
  it("называет, сколько оценок и сколько сделок без PnL", () => {
    expect(liveEstimateHint({ estimated: 1, unknown: 0 })).toBe(
      "Приблизительно: у 1 сделки PnL — оценка по ценам входа и выхода (исполнения не прочитаны).",
    );
    expect(liveEstimateHint({ estimated: 3, unknown: 2 })).toBe(
      "Приблизительно: у 3 сделок PnL — оценка по ценам входа и выхода (исполнения не прочитаны); у 2 сделок PnL неизвестен — в сумму не входит.",
    );
  });
});
