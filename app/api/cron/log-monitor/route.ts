import { runLogMonitor, sendMonitorTest } from "@/app/server/logMonitor";
import { getCronSecret } from "@/shared/config/env.server";
import { checkCronAuth } from "@/shared/lib/auth/cronAuth.server";
import { withLogging } from "@/shared/lib/route.server";

// Монитор журнала: pg_cron в Supabase раз в 15 минут. ?test=1 — тестовое сообщение в Telegram.
export const POST = withLogging(
  "cron.monitor",
  async (request) => {
    const result = checkCronAuth(
      request.headers.get("authorization"),
      getCronSecret(),
      process.env.NODE_ENV === "production",
    );
    if (result === "unavailable")
      return Response.json({ error: "CRON_SECRET не задан" }, { status: 503 });
    if (result === "unauthorized")
      return Response.json({ error: "Неверный секрет" }, { status: 401 });
    if (new URL(request.url).searchParams.get("test") === "1")
      return Response.json(await sendMonitorTest());
    const r = await runLogMonitor();
    return Response.json({
      issues: r.issues.map((i) => ({
        key: i.key,
        title: i.title,
        details: i.details,
      })),
      notified: r.notified,
      resolved: r.resolved,
      sent: r.sent,
      pruned: r.pruned,
    });
  },
  { quiet: true },
);
