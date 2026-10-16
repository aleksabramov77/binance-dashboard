import { connection } from "next/server";
import { getEngineExposure } from "@/app/server/experimentEngine";
import { withLogging } from "@/shared/lib/route.server";

// Открытые paper-сделки и демо-позиции — модалка выключения «Автоторговли» (spec 0044).
export const GET = withLogging("experiments.engine.exposure", async () => {
  await connection();
  return Response.json(await getEngineExposure());
});
