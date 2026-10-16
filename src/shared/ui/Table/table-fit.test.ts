import { describe, expect, it } from "vitest";
import { fitsWidth } from "./table-fit";

describe("fitsWidth", () => {
  it("таблица не шире рамки — помещается, в том числе с дробным пикселем", () => {
    expect(fitsWidth(1374, 1374)).toBe(true);
    expect(fitsWidth(1374.4, 1374)).toBe(true);
  });

  it("таблица уже рамки — помещается", () => {
    expect(fitsWidth(700, 1374)).toBe(true);
  });

  it("таблица шире рамки — не помещается", () => {
    expect(fitsWidth(1376, 1374)).toBe(false);
  });
});
