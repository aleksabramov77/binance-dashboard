import { connection } from "next/server";
import {
  getEngineStatus,
  setEngineEnabled,
} from "@/app/server/experimentEngine";
import { engineToggleSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Статус и тумблер движка лаборатории (spec 003, 2b) — для будущего хедера (задача 3a).
export const GET = withLogging(
  "experiments.engine",
  async () => {
    await connection();
    return Response.json(await getEngineStatus());
  },
  { quiet: true },
);

export const POST = withLogging(
  "experiments.engine.toggle",
  async (request) => {
    const parsed = engineToggleSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return Response.json(
        { error: "Ожидается { enabled: boolean }" },
        { status: 400 },
      );
    return Response.json(await setEngineEnabled(parsed.data.enabled));
  },
);
