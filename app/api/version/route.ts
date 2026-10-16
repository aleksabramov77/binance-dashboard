import { connection } from "next/server";
import { getDeploymentVersion } from "@/shared/config/env.server";
import type { AppVersion } from "@/shared/lib";
import { withLogging } from "@/shared/lib/route.server";

/** Версия сборки сервера: вкладка со старой сборкой сравнивает её со своей и предлагает обновиться. */
export const GET = withLogging(
  "version",
  async () => {
    await connection();
    const body: AppVersion = { version: getDeploymentVersion() };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  },
  { quiet: true },
);
