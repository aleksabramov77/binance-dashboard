import { getCronSecret } from "@/shared/config/env.server";
import { checkCronAuth } from "@/shared/lib/auth/cronAuth.server";
import { withLogging } from "@/shared/lib/route.server";

// Внешний крон дёргает тик движка экспериментов. Сессии здесь нет — защищает Bearer CRON_SECRET.
// Заготовка: сам тик подключит задача 1d/2b (spec 003).
export const POST = withLogging("cron.tick", async (request) => {
  const result = checkCronAuth(
    request.headers.get("authorization"),
    getCronSecret(),
    process.env.NODE_ENV === "production",
  );
  if (result === "unavailable")
    return Response.json({ error: "CRON_SECRET не задан" }, { status: 503 });
  if (result === "unauthorized")
    return Response.json({ error: "Неверный секрет" }, { status: 401 });
  return new Response(null, { status: 204 });
});
