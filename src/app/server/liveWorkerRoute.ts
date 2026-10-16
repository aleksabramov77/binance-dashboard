// Маршруты воркера реального счёта (spec 0047, 0049): входа через GitHub нет, свой Bearer LIVE_WORKER_SECRET. Без
// секрета или с неверным — 401; в production без LIVE_WORKER_SECRET — 503 (закрыто); локально без секрета — открыто,
// как cron. Тело — по Zod-схеме (иначе 400). Пути публичны в accessPolicy только поштучно.
import type { z } from "zod";
import { getLiveWorkerSecret } from "@/shared/config/env.server";
import { checkCronAuth } from "@/shared/lib/auth/cronAuth.server";
import { withLogging } from "@/shared/lib/route.server";

/** Проверка секрета воркера: null — можно, иначе готовый ответ 401/503. */
export function liveWorkerAuth(request: Request): Response | null {
  const auth = checkCronAuth(
    request.headers.get("authorization"),
    getLiveWorkerSecret(),
    process.env.NODE_ENV === "production",
  );
  if (auth === "unavailable")
    return Response.json(
      { error: "LIVE_WORKER_SECRET не задан" },
      { status: 503 },
    );
  if (auth === "unauthorized")
    return Response.json({ error: "Неверный секрет" }, { status: 401 });
  return null;
}

/** Текст ошибки разбора тела для ответа 400. */
export const issuesText = (error: z.ZodError) =>
  error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "тело"} — ${i.message}`)
    .join("; ");

/** POST-маршрут воркера: секрет → тело по схеме → обработчик (ответ — JSON). */
export function liveWorkerPost<T extends z.ZodType>(
  name: string,
  schema: T,
  handler: (body: z.infer<T>) => Promise<unknown>,
) {
  return withLogging(
    name,
    async (request) => {
      const denied = liveWorkerAuth(request);
      if (denied) return denied;
      const parsed = schema.safeParse(await request.json().catch(() => null));
      if (!parsed.success)
        return Response.json(
          { error: `Тело не распознано: ${issuesText(parsed.error)}` },
          { status: 400 },
        );
      return Response.json(await handler(parsed.data));
    },
    // Раз в минуту и на каждый вход: успешные запросы в журнал не пишем — события пишет композиция (live.*).
    { quiet: true },
  );
}
