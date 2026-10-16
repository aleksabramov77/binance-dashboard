import { connection } from "next/server";
import { getExperimentsOverview } from "@/app/server/experimentEngine";
import { parseRunParam } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Список экспериментов со статистикой периода (spec 003, 3b): ?run=<эпоха> | all, без параметра — текущая эпоха
// (spec 0046). Несуществующая эпоха — текущая и missingRun в ответе.
export const GET = withLogging(
  "experiments.list",
  async (request) => {
    await connection();
    const run = parseRunParam(new URL(request.url).searchParams.get("run"));
    return Response.json(await getExperimentsOverview(run ?? undefined));
  },
  { quiet: true },
);
