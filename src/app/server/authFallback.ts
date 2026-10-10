// /api/auth/* без Auth.js. Локально (disabled) /session честно отвечает «вход отключён» (200),
// чтобы клиент не ловил 404 в консоли. В production без настроек (misconfigured) сессию
// не отдаём: proxy и так закрывает /api/* ответом 503 (fail-closed).
import { AUTH_DISABLED_RESPONSE } from "@/features/auth";
import type { AuthMode } from "@/shared/lib/auth/accessPolicy";

const SESSION_PATH = "/api/auth/session";

export const authFallbackHandler = (mode: AuthMode) => (request: Request) =>
  mode === "disabled" && new URL(request.url).pathname === SESSION_PATH
    ? Response.json(AUTH_DISABLED_RESPONSE)
    : Response.json({ error: "Вход не настроен" }, { status: 404 });
