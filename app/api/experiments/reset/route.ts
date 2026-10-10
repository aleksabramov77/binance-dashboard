import { resetCapitals } from "@/app/server/experimentSettings";
import { resetRequestSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// «Сбросить тестовые капиталы» (spec 003, 3d): новая эпоха. Повтор с той же fromRunId — no-op.
export const POST = withLogging("experiments.reset", async (request) => {
  const parsed = resetRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Ожидается { fromRunId: number, note?: string }" },
      { status: 400 },
    );
  return Response.json(await resetCapitals(parsed.data));
});
