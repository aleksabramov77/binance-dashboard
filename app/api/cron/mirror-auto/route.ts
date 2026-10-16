import { runMirrorAuto } from "@/app/server/mirrorAuto";
import { getCronSecret } from "@/shared/config/env.server";
import { checkCronAuth } from "@/shared/lib/auth/cronAuth.server";
import { withLogging } from "@/shared/lib/route.server";

// Авто-зеркало (spec 0043): pg_cron в Supabase раз в сутки (07:00 UTC) включает и выключает демо-зеркала
// экспериментов в «Авто» по paper-сделкам и подсказывает по ручным положениям. ?dryRun=1 — тот же план без записи
// в БД, журнал и Telegram.
export const POST = withLogging("cron.mirror_auto", async (request) => {
  const result = checkCronAuth(
    request.headers.get("authorization"),
    getCronSecret(),
    process.env.NODE_ENV === "production",
  );
  if (result === "unavailable")
    return Response.json({ error: "CRON_SECRET не задан" }, { status: 503 });
  if (result === "unauthorized")
    return Response.json({ error: "Неверный секрет" }, { status: 401 });
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  return Response.json(await runMirrorAuto({ dryRun }));
});
