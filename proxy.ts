// Защита всех страниц и /api/*: пускаем только владельца (GitHub allowlist).
// Правила — в shared/lib/accessPolicy.ts; Auth.js — в src/app/server/auth.ts.
import { type NextRequest, NextResponse } from "next/server";
import { authConfig, nextAuth } from "@/app/server/auth";
import { decideAccess } from "@/shared/lib/auth/accessPolicy";

const allowed = authConfig.mode === "enabled" ? authConfig.allowedLogins : [];

function respond(request: NextRequest, login: string | null) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  switch (decideAccess({ mode: authConfig.mode, pathname, login, allowed })) {
    case "allow":
      return NextResponse.next();
    case "unauthorized":
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    case "unavailable":
      return isApi
        ? NextResponse.json({ error: "Вход не настроен" }, { status: 503 })
        : new NextResponse(
            "Вход не настроен: задайте AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET и AUTH_ALLOWED_GITHUB_LOGINS.",
            { status: 503 },
          );
    case "redirect-login": {
      const url = new URL("/login", request.url);
      url.searchParams.set("callbackUrl", pathname + search);
      return NextResponse.redirect(url);
    }
  }
}

const withSession = nextAuth?.auth((request) =>
  respond(request, request.auth?.user?.login ?? null),
);

export default function proxy(request: NextRequest) {
  // Контекст Auth.js нужен только роутам (params); нашему колбэку он не нужен.
  return withSession
    ? withSession(request, { params: Promise.resolve({}) })
    : respond(request, null);
}

export const config = {
  // Статика Next и файлы из public/ — без проверки.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
