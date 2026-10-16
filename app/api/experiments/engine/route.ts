import { after, connection } from "next/server";
import { nextAuth } from "@/app/server/auth";
import {
  getEngineStatus,
  setEngineEnabled,
} from "@/app/server/experimentEngine";
import { engineToggleSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Статус и тумблер «Автоторговля» движка лаборатории (spec 003, 2b; хедер и /settings — spec 0044).
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
    // Кто переключил — для журнала и Telegram (spec 0044); без настроенного входа сессии нет.
    const session = nextAuth ? await nextAuth.auth() : null;
    return Response.json(
      await setEngineEnabled(
        parsed.data.enabled,
        { by: session?.user?.login ?? null, authEnabled: nextAuth !== null },
        after,
      ),
    );
  },
);
