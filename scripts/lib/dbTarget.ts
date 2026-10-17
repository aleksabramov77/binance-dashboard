// Куда подключены скрипты лаборатории (`pnpm lab:report`, `pnpm lab:apply`, `pnpm lab:private`): база — файл SQLite
// (spec 0059). Путь печатается и пишется в артефакты, чтобы было видно, по какой базе отчёт и куда легли решения.
import type { DatabaseConfig } from "@/shared/config/env.server";

/** Снимок прод-базы, который скачивает `pnpm db:pull` (`pnpm lab:report --prod`). */
export const PROD_SNAPSHOT_PATH = "data/prod.db";

export function describeDatabase(config: DatabaseConfig): string {
  if (config.path === ":memory:") return "SQLite в памяти";
  return config.path === PROD_SNAPSHOT_PATH
    ? `SQLite ${config.path} (снимок прод-базы, pnpm db:pull)`
    : `SQLite ${config.path}`;
}

/**
 * Отказ записи в прод из скриптов лаборатории (spec 0059): прод — файл SQLite на VM, с ноутбука в него не пишем
 * (отдельная задача в очереди PRD). Тумблеры — на сайте.
 */
export const PROD_WRITE_HINT = [
  "Прод — файл SQLite на VM (spec 0059): скрипты лаборатории в него пока не пишут — это отдельная задача в очереди PRD.",
  "  Тумблеры экспериментов и демо-зеркала — на сайте: /experiments и /settings.",
].join("\n");
