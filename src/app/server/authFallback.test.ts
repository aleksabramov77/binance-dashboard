import { describe, expect, it } from "vitest";
import { AUTH_DISABLED_RESPONSE } from "@/features/auth";
import { authFallbackHandler } from "./authFallback";

const req = (path: string) => new Request(`http://localhost${path}`);

describe("authFallbackHandler — /api/auth/* без Auth.js", () => {
  it("вход отключён локально: /session отвечает 200, а не 404", async () => {
    const res = authFallbackHandler("disabled")(req("/api/auth/session"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(AUTH_DISABLED_RESPONSE);
  });

  it("вход отключён локально: прочие /api/auth/* → 404", () => {
    expect(
      authFallbackHandler("disabled")(req("/api/auth/signin/github")).status,
    ).toBe(404);
  });

  it("misconfigured (fail-closed): сессию не отдаём", () => {
    expect(
      authFallbackHandler("misconfigured")(req("/api/auth/session")).status,
    ).toBe(404);
  });
});
