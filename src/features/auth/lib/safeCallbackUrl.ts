/** Куда вернуть после входа: только путь внутри приложения (без открытого редиректа). */
export function safeCallbackUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.startsWith("/login") ? "/" : value;
}
