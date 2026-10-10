import { connection } from "next/server";
import { getExperimentsOverview } from "@/app/server/experimentEngine";
import { withLogging } from "@/shared/lib/route.server";

// Список экспериментов текущей эпохи со статистикой (spec 003, 3b).
export const GET = withLogging(
  "experiments.list",
  async () => {
    await connection();
    return Response.json(await getExperimentsOverview());
  },
  { quiet: true },
);
