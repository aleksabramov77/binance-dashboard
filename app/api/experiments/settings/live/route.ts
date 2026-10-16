import { nextAuth } from "@/app/server/auth";
import { setLiveMode } from "@/app/server/liveMirror";
import { experimentLiveModeSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Переключатель «Реальный счёт» эксперимента (spec 0049, 0053): «Выкл · Авто · Вкл · Вкл + автовыкл»; всё, кроме «Выкл», —
// со словом подтверждения и при годном ключе; пороги — Zod (1–1000 $, серия 1–50).
export const POST = withLogging(
  "experiments.settings.live",
  async (request) => {
    const parsed = experimentLiveModeSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return Response.json(
        {
          error:
            parsed.error.issues[0]?.path[0] === "thresholds"
              ? `Пороги: ${parsed.error.issues[0].message}`
              : "Ожидается { id, mode, confirm?, thresholds? }",
        },
        { status: 400 },
      );
    const session = nextAuth ? await nextAuth.auth() : null;
    const r = await setLiveMode(parsed.data, {
      by: session?.user?.login ?? null,
      authEnabled: nextAuth !== null,
    });
    return r.ok
      ? Response.json(r)
      : Response.json({ error: r.error }, { status: r.status });
  },
);
