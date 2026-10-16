import { connection } from "next/server";
import { getTradeStats } from "@/app/server/experimentEngine";
import { parseStatsQuery } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Разрезы сделок лаборатории: группировка и фильтры из query-строки (spec 003, 3c).
// Статический сегмент stats важнее динамического [id].
export const GET = withLogging(
  "experiments.stats",
  async (request) => {
    await connection();
    const parsed = parseStatsQuery(new URL(request.url).searchParams);
    if (!parsed.success)
      return Response.json(
        { error: "Неверные параметры разреза", issues: parsed.error.issues },
        { status: 400 },
      );
    return Response.json(await getTradeStats(parsed.data));
  },
  { quiet: true },
);
