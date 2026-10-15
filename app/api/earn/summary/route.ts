import { connection } from "next/server";
import { loadEarnSummary } from "@/features/load-earn-catalog";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("earn.summary", async () => {
  await connection();
  return Response.json(await loadEarnSummary());
});
