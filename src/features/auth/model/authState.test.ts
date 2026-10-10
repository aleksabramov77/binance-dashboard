import { describe, expect, it } from "vitest";
import { AUTH_DISABLED_RESPONSE, toAuthState } from "./schema";

describe("toAuthState", () => {
  it("вход локально отключён → disabled", () => {
    expect(toAuthState(AUTH_DISABLED_RESPONSE)).toEqual({ status: "disabled" });
  });

  it("Auth.js без сессии (null или {}) → signed-out", () => {
    expect(toAuthState(null)).toEqual({ status: "signed-out" });
    expect(toAuthState({})).toEqual({ status: "signed-out" });
  });

  it("сессия Auth.js → signed-in с пользователем", () => {
    expect(
      toAuthState({ user: { login: "octo", name: "Octo", image: null } }),
    ).toEqual({
      status: "signed-in",
      user: { login: "octo", name: "Octo", image: null },
    });
  });
});
