import { connection } from "next/server";
import { getExperimentDetail } from "@/app/server/experimentEngine";
import { parseRunParam } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

// Эксперимент: суть, конфиг, статистика, equity-кривая и последние сделки периода (spec 003, 3b); ?run=<эпоха> | all
// (spec 0046), без параметра — текущая эпоха.
export const GET = withLogging(
  "experiments.detail",
  async (request, ctx: RouteContext<"/api/experiments/[id]">) => {
    await connection();
    const { id } = await ctx.params;
    const params = new URL(request.url).searchParams;
    const raw = Number(params.get("limit"));
    const limit =
      Number.isInteger(raw) && raw > 0
        ? Math.min(raw, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const run = parseRunParam(params.get("run"));
    const detail = await getExperimentDetail(id, limit, run ?? undefined);
    if (!detail)
      return Response.json({ error: "Эксперимент не найден" }, { status: 404 });
    return Response.json(detail);
  },
  { quiet: true },
);
