import { describe, expect, it } from "vitest";
import { getAuthConfig } from "@/shared/config/env.server";
import {
  decideAccess,
  isAllowedLogin,
  isPublicPath,
  parseAllowedLogins,
} from "./accessPolicy";
import { checkCronAuth, checkSecretHeader } from "./cronAuth.server";

const full = {
  AUTH_SECRET: "s",
  AUTH_GITHUB_ID: "id",
  AUTH_GITHUB_SECRET: "gs",
  AUTH_ALLOWED_GITHUB_LOGINS: "aleksabramov77",
};

describe("allowlist", () => {
  it("разбирает список и сравнивает без учёта регистра", () => {
    const allowed = parseAllowedLogins(" AleksAbramov77 , other ,");
    expect(allowed).toEqual(["aleksabramov77", "other"]);
    expect(isAllowedLogin("ALEKSABRAMOV77", allowed)).toBe(true);
    expect(isAllowedLogin("stranger", allowed)).toBe(false);
    expect(isAllowedLogin(null, allowed)).toBe(false);
  });
});

describe("getAuthConfig", () => {
  it("локально без AUTH_SECRET защита выключена", () => {
    expect(getAuthConfig({ NODE_ENV: "development" })).toEqual({
      mode: "disabled",
    });
  });

  it("в production без настроек — fail-closed", () => {
    const config = getAuthConfig({ NODE_ENV: "production" });
    expect(config.mode).toBe("misconfigured");
    if (config.mode === "misconfigured")
      expect(config.missing).toContain("AUTH_SECRET");
  });

  it("частичная настройка или пустой allowlist — тоже закрыто", () => {
    expect(
      getAuthConfig({ NODE_ENV: "development", AUTH_SECRET: "s" }).mode,
    ).toBe("misconfigured");
    expect(
      getAuthConfig({
        ...full,
        NODE_ENV: "production",
        AUTH_ALLOWED_GITHUB_LOGINS: " , ",
      }).mode,
    ).toBe("misconfigured");
  });

  it("полная настройка включает вход", () => {
    expect(getAuthConfig({ ...full, NODE_ENV: "production" })).toMatchObject({
      mode: "enabled",
      allowedLogins: ["aleksabramov77"],
    });
  });
});

describe("decideAccess", () => {
  const allowed = ["aleksabramov77"];
  const decide = (
    pathname: string,
    login: string | null,
    mode: "enabled" | "disabled" | "misconfigured" = "enabled",
  ) => decideAccess({ mode, pathname, login, allowed });

  it("владелец проходит везде", () => {
    expect(decide("/signals", "aleksabramov77")).toBe("allow");
    expect(decide("/api/openrouter/balance", "aleksabramov77")).toBe("allow");
  });

  it("без сессии: страницы → вход, API → 401", () => {
    expect(decide("/signals", null)).toBe("redirect-login");
    expect(decide("/api/analysis", null)).toBe("unauthorized");
  });

  it("чужой логин не проходит, даже с сессией", () => {
    expect(decide("/", "stranger")).toBe("redirect-login");
    expect(decide("/api/trade", "stranger")).toBe("unauthorized");
  });

  it("вход и cron открыты без сессии", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(decide("/api/auth/callback/github", null)).toBe("allow");
    expect(decide("/api/cron/tick", null)).toBe("allow");
    expect(isPublicPath("/api/authx")).toBe(false);
  });

  it("webhook Telegram открыт без сессии, остальные API — нет", () => {
    expect(decide("/api/telegram/webhook", null)).toBe("allow");
    expect(isPublicPath("/api/telegramx")).toBe(false);
    expect(decide("/api/logs", null)).toBe("unauthorized");
    expect(decide("/api/telegram/webhook", null, "misconfigured")).toBe(
      "unavailable",
    );
  });

  it("пульс воркера реального счёта открыт без сессии, карточка /api/live/status — нет", () => {
    expect(decide("/api/live/heartbeat", null)).toBe("allow");
    expect(decide("/api/live/status", null)).toBe("unauthorized");
    expect(isPublicPath("/api/live/heartbeatx")).toBe(false);
    expect(isPublicPath("/api/live/")).toBe(false);
    // Реальное зеркало (spec 0049): маршруты воркера — поштучно; стоп и карточка — только после входа.
    for (const p of [
      "state",
      "claim",
      "skip",
      "filled",
      "open",
      "claim-close",
      "close",
      "legs",
      "close-all",
      "reconcile",
    ])
      expect(decide(`/api/live/mirror/${p}`, null)).toBe("allow");
    expect(decide("/api/live/mirror/other", null)).toBe("unauthorized");
    expect(decide("/api/live/mirror", null)).toBe("unauthorized");
    expect(decide("/api/live/halt", null)).toBe("unauthorized");
    expect(decide("/api/experiments/settings/live", null)).toBe("unauthorized");
    expect(decide("/api/live/heartbeat", null, "misconfigured")).toBe(
      "unavailable",
    );
  });

  it("не настроено — закрыто всё, включая вход; выключено — всё открыто", () => {
    expect(decide("/login", null, "misconfigured")).toBe("unavailable");
    expect(decide("/api/auth/signin", null, "misconfigured")).toBe(
      "unavailable",
    );
    expect(decide("/api/trade", null, "disabled")).toBe("allow");
  });
});

describe("checkCronAuth", () => {
  it("проверяет Bearer-секрет", () => {
    expect(checkCronAuth("Bearer abc", "abc", true)).toBe("ok");
    expect(checkCronAuth("Bearer abd", "abc", true)).toBe("unauthorized");
    expect(checkCronAuth(null, "abc", true)).toBe("unauthorized");
  });

  it("без секрета: production закрыт, локально открыт", () => {
    expect(checkCronAuth(null, null, true)).toBe("unavailable");
    expect(checkCronAuth(null, null, false)).toBe("ok");
  });
});

describe("checkSecretHeader", () => {
  it("верный секрет — ok, неверный или без заголовка — unauthorized", () => {
    expect(checkSecretHeader("s3cret", "s3cret")).toBe("ok");
    expect(checkSecretHeader("s3cres", "s3cret")).toBe("unauthorized");
    expect(checkSecretHeader("", "s3cret")).toBe("unauthorized");
    expect(checkSecretHeader(null, "s3cret")).toBe("unauthorized");
  });

  it("секрет не задан — unavailable, даже если заголовок есть", () => {
    expect(checkSecretHeader("x", null)).toBe("unavailable");
    expect(checkSecretHeader(null, null)).toBe("unavailable");
  });
});
