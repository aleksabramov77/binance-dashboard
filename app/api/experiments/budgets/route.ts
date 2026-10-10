import { connection } from "next/server";
import { getExperimentBudgets } from "@/app/server/experimentBudgets";
import { withLogging } from "@/shared/lib/route.server";

// Бюджеты лаборатории по рынкам в текущей эпохе — для хедера (spec 003 · 3a).
export const GET = withLogging(
  "experiments.budgets",
  async () => {
    await connection();
    return Response.json(await getExperimentBudgets());
  },
  { quiet: true },
);
