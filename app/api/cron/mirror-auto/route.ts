import { runLiveAuto } from "@/app/server/liveAuto";
import { runMirrorAuto } from "@/app/server/mirrorAuto";
import { getCronSecret } from "@/shared/config/env.server";
import { checkCronAuth } from "@/shared/lib/auth/cronAuth.server";
import { withLogging } from "@/shared/lib/route.server";

// Авто-зеркало (spec 0043): pg_cron в Supabase раз в сутки (07:00 UTC) включает и выключает демо-зеркала
// экспериментов в «Авто» по paper-сделкам и подсказывает по ручным положениям. Следом — режимы реального счёта
// (spec 0053): «Авто» по демо-сделкам и порогам, «Вкл + автовыкл» по порогам, подсказки ручному «Вкл». Сбой одной
// проверки не отменяет другую: реальный счёт — в поле live.error, демо — в error и статусе 500. ?dryRun=1 — тот же
// план без записи в БД, журнал и Telegram.
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
  const mirror = await runMirrorAuto({ dryRun }).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const live = await runLiveAuto({ dryRun }).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  return Response.json(
    { ...mirror, live },
    { status: "error" in mirror ? 500 : 200 },
  );
});
