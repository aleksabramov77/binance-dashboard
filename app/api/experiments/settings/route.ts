import { connection } from "next/server";
import { getLabSettings } from "@/app/server/experimentSettings";
import { withLogging } from "@/shared/lib/route.server";

// Настройки лаборатории для /settings (spec 003, 3d): эпоха, бюджеты, эксперименты.
export const GET = withLogging(
  "experiments.settings",
  async () => {
    await connection();
    return Response.json(await getLabSettings());
  },
  { quiet: true },
);
