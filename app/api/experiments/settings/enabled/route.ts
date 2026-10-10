import { toggleExperiment } from "@/app/server/experimentSettings";
import { experimentEnabledSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Вкл/выкл отдельного эксперимента: выключенный не открывает новые сделки.
export const POST = withLogging("experiments.enabled", async (request) => {
  const parsed = experimentEnabledSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Ожидается { id: string, enabled: boolean }" },
      { status: 400 },
    );
  const settings = await toggleExperiment(parsed.data.id, parsed.data.enabled);
  if (!settings)
    return Response.json(
      { error: `Эксперимент ${parsed.data.id} не найден` },
      { status: 404 },
    );
  return Response.json(settings);
});
