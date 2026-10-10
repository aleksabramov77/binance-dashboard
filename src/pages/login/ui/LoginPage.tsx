import { Suspense } from "react";
import { SignInButton, safeCallbackUrl } from "@/features/auth";
import { getAuthConfig } from "@/shared/config/env.server";

const ERRORS: Record<string, string> = {
  AccessDenied:
    "Этот GitHub-аккаунт не в списке разрешённых. Войдите аккаунтом владельца.",
  Configuration:
    "Вход настроен неверно — проверьте переменные AUTH_* на сервере.",
};

interface Props {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

// Ошибка и адрес возврата — из URL запроса, поэтому рендерятся на запрос (внутри Suspense).
async function LoginForm({ searchParams }: Props) {
  const { error, callbackUrl } = await searchParams;
  const enabled = getAuthConfig().mode === "enabled";
  return (
    <>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
        >
          {ERRORS[error] ?? `Не удалось войти (${error}). Попробуйте ещё раз.`}
        </p>
      ) : null}
      {enabled ? (
        <SignInButton callbackUrl={safeCallbackUrl(callbackUrl)} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Вход выключен: локальный режим без <code>AUTH_SECRET</code>, все
          страницы открыты.
        </p>
      )}
    </>
  );
}

export function LoginPage({ searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 pt-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Вход</h1>
        <p className="text-sm text-muted-foreground">
          Дашборд личный: войти может только владелец через свой GitHub.
        </p>
      </header>
      <Suspense>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
