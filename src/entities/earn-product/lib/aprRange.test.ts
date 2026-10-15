import { describe, expect, it } from "vitest";
import { aprRange } from "./aprRange";

describe("диапазон APR", () => {
  it("одно число, если границы совпадают, иначе «от–до %»", () => {
    expect(aprRange(0.0361, 0.0361)).toBe("3,61 %");
    expect(aprRange(0.0365, 2.8148)).toBe("3,65–281,48 %");
  });
});
