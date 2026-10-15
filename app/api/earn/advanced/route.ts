import { connection } from "next/server";
import { loadAdvancedCatalog } from "@/features/load-earn-catalog";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("earn.advanced", async () => {
  await connection();
  return Response.json(await loadAdvancedCatalog());
});
