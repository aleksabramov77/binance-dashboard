import { runDemoMirror } from "@/app/server/demoMirror";
import { getCronSecret } from "@/shared/config/env.server";
import { checkCronAuth } from "@/shared/lib/auth/cronAuth.server";
import { withLogging } from "@/shared/lib/route.server";

// Demo-зеркало (spec 008): pg_cron в Supabase раз в минуту повторяет свежие paper-входы
// отмеченных экспериментов на Binance Demo и закрывает демо-позиции закрытых paper-сделок.

// Прогон с 10 входами при сбоях биржи (перечитывание неизвестного исхода, повторы) — минуты, а не
// секунды: без явного лимита Vercel оборвёт функцию посреди входа. Новые входы runMirror не
// начинает после MIRROR.runBudgetMs (200 с), остаток — до 300 с (максимум Vercel с Fluid compute).
export const maxDuration = 300;
export const POST = withLogging(
  "cron.mirror",
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
    return Response.json(await runDemoMirror());
  },
  { quiet: true },
);
