import { describe, expect, it } from "vitest";
import { describeExposure } from "./exposureText";

describe("describeExposure", () => {
  it("склоняет paper-сделки и демо-позиции по числу", () => {
    expect(describeExposure({ openPaper: 5, openDemo: 0 })).toBe(
      "Открыто 5 paper-сделок и 0 демо-позиций",
    );
    expect(describeExposure({ openPaper: 1, openDemo: 2 })).toBe(
      "Открыто 1 paper-сделка и 2 демо-позиции",
    );
    expect(describeExposure({ openPaper: 22, openDemo: 21 })).toBe(
      "Открыто 22 paper-сделки и 21 демо-позиция",
    );
    // 11–14 — всегда «сделок/позиций».
    expect(describeExposure({ openPaper: 11, openDemo: 112 })).toBe(
      "Открыто 11 paper-сделок и 112 демо-позиций",
    );
  });
});
