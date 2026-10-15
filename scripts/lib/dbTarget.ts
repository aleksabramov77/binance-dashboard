// Куда подключены скрипты лаборатории (`pnpm lab:report`, `pnpm lab:apply`): без DATABASE_URL приложение
// молча берёт локальную PGlite, а она пуста — отчёт был бы пустым, а «применённые» решения не дошли бы до прода.
// Поэтому цель подключения печатается и пишется в артефакты, без секретов: только вид и хост/каталог.
import type { DatabaseConfig } from "@/shared/config/env.server";

export function describeDatabase(config: DatabaseConfig): string {
  if (config.kind === "pglite") return `локальная PGlite (${config.dir})`;
  try {
    const u = new URL(config.url);
    const db = u.pathname.replace(/^\//, "");
    return `Postgres ${u.hostname}${u.port ? `:${u.port}` : ""}${db ? `/${db}` : ""}`;
  } catch {
    return "Postgres (DATABASE_URL)";
  }
}

export const isLocalDatabase = (config: DatabaseConfig): boolean =>
  config.kind === "pglite";
