import { describe, expect, it } from "vitest";
import { formatRate } from "./formatStats";

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
