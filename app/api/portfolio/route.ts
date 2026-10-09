import { connection } from "next/server";
import { loadPortfolio } from "@/features/load-portfolio";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("portfolio", async () => {
  await connection();
  return Response.json(await loadPortfolio());
});
