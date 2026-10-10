// Вход через GitHub (Auth.js v5). Пускаем только логины из AUTH_ALLOWED_GITHUB_LOGINS.
// Без настроек (локально) Auth.js не создаётся: proxy пропускает всё, /api/auth/* → 404.
import NextAuth, { type DefaultSession, type NextAuthResult } from "next-auth";
import GitHub from "next-auth/providers/github";
import { getAuthConfig } from "@/shared/config/env.server";
import { isAllowedLogin } from "@/shared/lib/auth/accessPolicy";
import { log } from "@/shared/lib/logger.server";

export const authConfig = getAuthConfig();

const loginOf = (value: unknown) => (typeof value === "string" ? value : null);

function createAuth(): NextAuthResult | null {
  if (authConfig.mode !== "enabled") {
    if (authConfig.mode === "misconfigured")
      log.error(
        "auth.config",
        "Вход не настроен — приложение закрыто (fail-closed)",
        { missing: authConfig.missing },
      );
    return null;
  }
  const { allowedLogins } = authConfig;
  return NextAuth({
    secret: authConfig.secret,
    // Сервер стоит за своим reverse proxy (Caddy) и сам задаёт Host.
    trustHost: true,
    session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
    providers: [
      GitHub({
        clientId: authConfig.githubId,
        clientSecret: authConfig.githubSecret,
      }),
    ],
    pages: { signIn: "/login", error: "/login" },
    callbacks: {
      signIn({ profile }) {
        const login = loginOf(profile?.login);
        const ok = isAllowedLogin(login, allowedLogins);
        if (!ok)
          log.warn("auth.denied", `Вход отклонён: ${login ?? "без логина"}`, {
            login,
          });
        return ok;
      },
      jwt({ token, profile }) {
        if (profile) token.login = loginOf(profile.login);
        return token;
      },
      session({ session, token }) {
        return {
          ...session,
          user: { ...session.user, login: loginOf(token.login) },
        };
      },
    },
  });
}

export const nextAuth = createAuth();

declare module "next-auth" {
  interface Session {
    user: { login: string | null } & DefaultSession["user"];
  }
}
