import { connection } from "next/server";
import { buildOverview } from "@/features/collect-snapshot";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("earn", async () => {
  await connection();
  return Response.json(await buildOverview());
});
