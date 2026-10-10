import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuthResult = "ok" | "unauthorized" | "unavailable";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Проверка `Authorization: Bearer <CRON_SECRET>` для внешнего крона.
 * Без секрета: локально — пропускаем, в production — закрыто (fail-closed).
 * Сравнение по хэшам — постоянное время и одинаковая длина буферов.
 */
export function checkCronAuth(
  authorization: string | null,
  secret: string | null,
  isProduction: boolean,
): CronAuthResult {
  if (!secret) return isProduction ? "unavailable" : "ok";
  if (!authorization) return "unauthorized";
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))
    ? "ok"
    : "unauthorized";
}
