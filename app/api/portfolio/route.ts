import { connection } from "next/server";
import { getMainCredentials } from "@/app/server/accountKey";
import { loadPortfolio } from "@/features/load-portfolio";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("portfolio", async () => {
  await connection();
  // Ключ основного аккаунта — платформы (spec 0065): база → env → нет.
  return Response.json(await loadPortfolio(getMainCredentials()));
});
