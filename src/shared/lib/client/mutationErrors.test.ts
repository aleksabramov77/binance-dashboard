import { describe, expect, it } from "vitest";
import {
  EXPECTED_ERRORS_META,
  shouldReportMutationError,
} from "./mutationErrors";

describe("shouldReportMutationError", () => {
  it("мутация с ожидаемыми отказами — в журнал не пишется", () => {
    expect(shouldReportMutationError(EXPECTED_ERRORS_META)).toBe(false);
  });

  it("без meta и с другой meta — пишется, как раньше", () => {
    expect(shouldReportMutationError(undefined)).toBe(true);
    expect(shouldReportMutationError({})).toBe(true);
    expect(shouldReportMutationError({ expectedErrors: "yes" })).toBe(true);
  });
});
