import { resetExperimentCapital } from "@/app/server/experimentSettings";
import { experimentResetSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Отдельный сброс paper-капитала одного эксперимента (эпоха и другие эксперименты не меняются).
export const POST = withLogging("experiments.reset_one", async (request) => {
  const parsed = experimentResetSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Ожидается { id: string }" },
      { status: 400 },
    );
  const result = await resetExperimentCapital(parsed.data.id);
  if (!result)
    return Response.json(
      { error: `Эксперимент ${parsed.data.id} не найден` },
      { status: 404 },
    );
  return Response.json(result);
});
