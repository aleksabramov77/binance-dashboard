import { describe, expect, it } from "vitest";
import { getRunnerRole } from "./env.server";

describe("ENGINE_RUNNER", () => {
  it("по умолчанию oracle, допустимые значения принимаются", () => {
    expect(getRunnerRole({})).toEqual({ role: "oracle", invalid: null });
    expect(getRunnerRole({ ENGINE_RUNNER: "supabase" })).toEqual({
      role: "supabase",
      invalid: null,
    });
  });

  it("неизвестное значение — oracle и признак ошибки для предупреждения", () => {
    expect(getRunnerRole({ ENGINE_RUNNER: "vercel" })).toEqual({
      role: "oracle",
      invalid: "vercel",
    });
  });
});
