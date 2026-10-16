import { nextAuth } from "@/app/server/auth";
import { setLiveMirror } from "@/app/server/liveMirror";
import { experimentLiveMirrorSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Переключатель «Реальный счёт» эксперимента (spec 0049, AC1): включение — со словом подтверждения и при годном ключе.
export const POST = withLogging(
  "experiments.settings.live",
  async (request) => {
    const parsed = experimentLiveMirrorSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return Response.json(
        { error: "Ожидается { id, liveMirror, confirm? }" },
        { status: 400 },
      );
    const session = nextAuth ? await nextAuth.auth() : null;
    const r = await setLiveMirror(parsed.data, {
      by: session?.user?.login ?? null,
      authEnabled: nextAuth !== null,
    });
    return r.ok
      ? Response.json(r)
      : Response.json({ error: r.error }, { status: r.status });
  },
);
