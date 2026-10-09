import { connection } from "next/server";
import { scanMarket } from "@/features/scan-market";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("signals", async () => {
  await connection();
  return Response.json(await scanMarket());
});
