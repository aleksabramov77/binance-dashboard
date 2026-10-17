import { connection } from "next/server";
import { getMainCredentials } from "@/app/server/accountKey";
import { loadAdvancedCatalog } from "@/features/load-earn-catalog";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("earn.advanced", async () => {
  await connection();
  // Ключ основного аккаунта — платформы (spec 0065): база → env → нет.
  return Response.json(await loadAdvancedCatalog(getMainCredentials));
});
