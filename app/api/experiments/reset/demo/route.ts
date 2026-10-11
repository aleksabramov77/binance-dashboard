import { resetDemo } from "@/app/server/demoMirror";
import { demoResetRequestSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Демо-сброс: закрыть демо-позиции эксперимента ({ id }) или всех ({ id: null }) и обнулить
// демо-статистику. Paper-учёт не меняется.
export const POST = withLogging("experiments.reset_demo", async (request) => {
  const parsed = demoResetRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Ожидается { id: string | null }" },
      { status: 400 },
    );
  return Response.json(await resetDemo(parsed.data.id));
});
