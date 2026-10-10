import { collectSnapshot } from "@/features/collect-snapshot";
import { getCronSecret } from "@/shared/config/env.server";
import { checkCronAuth } from "@/shared/lib/auth/cronAuth.server";
import { withLogging } from "@/shared/lib/route.server";

// Снимок Earn по расписанию: pg_cron в Supabase дважды в день (09:00 и 21:00 по Бишкеку) вызывает этот
// роут на Vercel. Сессии здесь нет — защищает Bearer CRON_SECRET (тот же, что у /api/cron/tick).
export const POST = withLogging("cron.earn", async (request) => {
  const result = checkCronAuth(
    request.headers.get("authorization"),
    getCronSecret(),
    process.env.NODE_ENV === "production",
  );
  if (result === "unavailable")
    return Response.json({ error: "CRON_SECRET не задан" }, { status: 503 });
  if (result === "unauthorized")
    return Response.json({ error: "Неверный секрет" }, { status: 401 });
  const { snapshot } = await collectSnapshot();
  return Response.json({
    fetchedAt: snapshot.fetchedAt,
    offers: snapshot.offers.length,
  });
});
