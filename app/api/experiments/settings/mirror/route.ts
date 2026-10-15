import { toggleDemoMirror } from "@/app/server/experimentSettings";
import { experimentDemoMirrorSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Demo-зеркало эксперимента (spec 008): новые paper-входы повторяются на Binance Demo.
export const POST = withLogging("experiments.mirror", async (request) => {
  const parsed = experimentDemoMirrorSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Ожидается { id: string, demoMirror: boolean }" },
      { status: 400 },
    );
  const settings = await toggleDemoMirror(
    parsed.data.id,
    parsed.data.demoMirror,
  );
  if (!settings)
    return Response.json(
      { error: `Эксперимент ${parsed.data.id} не найден` },
      { status: 404 },
    );
  // Группа не умеет демо-зеркало (COIN-M — позже, spec 0023).
  if ("blocked" in settings)
    return Response.json({ error: settings.blocked }, { status: 400 });
  return Response.json(settings);
});
