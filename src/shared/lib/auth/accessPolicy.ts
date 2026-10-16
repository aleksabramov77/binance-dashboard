// Правила доступа к приложению: чистые функции, их проверяют тесты и вызывает proxy.ts.

/**
 * disabled — защита выключена (локальная разработка без AUTH_SECRET);
 * enabled — вход через GitHub по allowlist;
 * misconfigured — в production нет нужных переменных: всё закрыто (fail-closed).
 */
export type AuthMode = "disabled" | "enabled" | "misconfigured";

export type AccessDecision =
  | "allow"
  | "redirect-login"
  | "unauthorized"
  | "unavailable";

/** Пути без проверки сессии: сам вход, cron и webhook Telegram (у них свои секреты). */
const PUBLIC_PREFIXES = ["/api/auth/", "/api/cron/", "/api/telegram/"];
/**
 * Точные публичные пути: страница входа, пульс и маршруты реального зеркала воркера (Bearer LIVE_WORKER_SECRET,
 * spec 0047, 0049). Остальные /api/live/* (карточка, аварийный стоп) — только после входа.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/live/heartbeat",
  // Реальное зеркало (spec 0049): хранилище воркера, Bearer LIVE_WORKER_SECRET — поштучно.
  "/api/live/mirror/state",
  "/api/live/mirror/claim",
  "/api/live/mirror/skip",
  "/api/live/mirror/open",
  "/api/live/mirror/claim-close",
  "/api/live/mirror/close",
  "/api/live/mirror/legs",
  "/api/live/mirror/close-all",
  "/api/live/mirror/reconcile",
];

export const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) ||
  PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/** Список логинов из env: «a, B» → ["a", "b"]. */
export const parseAllowedLogins = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);

/** Логин GitHub без учёта регистра (GitHub логины регистронезависимы). */
export const isAllowedLogin = (
  login: string | null | undefined,
  allowed: readonly string[],
) => !!login && allowed.includes(login.toLowerCase());

/** Что делать с запросом: пропустить, отправить на вход, 401 или 503. */
export function decideAccess(input: {
  mode: AuthMode;
  pathname: string;
  /** Логин из сессии; null — сессии нет. */
  login: string | null;
  allowed: readonly string[];
}): AccessDecision {
  const { mode, pathname } = input;
  if (mode === "disabled") return "allow";
  if (mode === "misconfigured") return "unavailable";
  if (isPublicPath(pathname)) return "allow";
  if (isAllowedLogin(input.login, input.allowed)) return "allow";
  return pathname.startsWith("/api/") ? "unauthorized" : "redirect-login";
}
