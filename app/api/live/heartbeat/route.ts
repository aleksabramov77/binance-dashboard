import { ingestHeartbeat } from "@/app/server/liveAccount";
import { liveWorkerAuth } from "@/app/server/liveWorkerRoute";
import { liveHeartbeatSchema } from "@/entities/live-account";
import { withLogging } from "@/shared/lib/route.server";

// Пульс воркера реального счёта (spec 0047, AC4): раз в минуту, Bearer LIVE_WORKER_SECRET. Входа через GitHub
// здесь нет (путь публичный в accessPolicy) — своя проверка секрета: без секрета или с неверным — 401,
// в production без LIVE_WORKER_SECRET — 503 (закрыто). Локально без секрета — открыто, как cron.
export const POST = withLogging(
  "live.heartbeat",
  async (request) => {
    const isProduction = process.env.NODE_ENV === "production";
    const denied = liveWorkerAuth(request);
    if (denied) return denied;

    const parsed = liveHeartbeatSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return Response.json(
        {
          error: `Пульс не распознан: ${parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".") || "тело"} — ${i.message}`)
            .join("; ")}`,
        },
        { status: 400 },
      );
    if (parsed.data.fixture !== null && isProduction)
      return Response.json(
        { error: "Фикстуры пульса — только для локальной проверки" },
        { status: 400 },
      );
    return Response.json(await ingestHeartbeat(parsed.data));
  },
  // Пульс раз в минуту: успешные запросы в журнал не пишем, смены состояния — запись live.status.
  { quiet: true },
);
