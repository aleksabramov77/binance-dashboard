import { describe, expect, it } from "vitest";
import {
  expectedErrorsMeta,
  shouldReportMutationError,
} from "./mutationErrors";

class Rejected extends Error {}

describe("shouldReportMutationError", () => {
  const meta = expectedErrorsMeta((e) => e instanceof Rejected);

  it("ошибка, которую предикат мутации считает ожидаемой, — в журнал не пишется", () => {
    expect(shouldReportMutationError(meta, new Rejected("422"))).toBe(false);
  });

  it("другие ошибки той же мутации (сеть, 5xx) — пишутся", () => {
    expect(shouldReportMutationError(meta, new TypeError("fetch"))).toBe(true);
  });

  it("без meta и с другой meta — пишется, как раньше", () => {
    expect(shouldReportMutationError(undefined, new Rejected())).toBe(true);
    expect(shouldReportMutationError({}, new Rejected())).toBe(true);
    expect(
      shouldReportMutationError({ isExpectedError: true }, new Rejected()),
    ).toBe(true);
  });
});
