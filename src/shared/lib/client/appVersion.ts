// Версия сборки — deploymentId из next.config.ts (на Vercel — id деплоя, локально не задан).
// Вкладка, открытая до деплоя, продолжает работать старым JS против нового API: её ошибки — не ошибки прода.
import { z } from "zod";

/** Ответ GET /api/version: версия сборки сервера; null — не задана (локально). */
export const appVersionSchema = z.object({ version: z.string().nullable() });
export type AppVersion = z.infer<typeof appVersionSchema>;

/**
 * Версия сборки, с которой загружена страница; null — на сервере или без deploymentId.
 * Next читает `data-dpl-id` с `<html>` при загрузке и сразу снимает атрибут, а в клиентском коде
 * подставляет вместо `process.env.NEXT_DEPLOYMENT_ID` сохранённое значение (`globalThis.NEXT_DEPLOYMENT_ID`).
 */
export function getPageVersion(): string | null {
  if (typeof window === "undefined") return null;
  return (
    process.env.NEXT_DEPLOYMENT_ID ||
    document.documentElement.dataset.dplId ||
    null
  );
}

/** Клиент со старой сборкой: обе версии известны и различаются. */
export const isStaleVersion = (
  clientVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): boolean =>
  Boolean(clientVersion && serverVersion && clientVersion !== serverVersion);
