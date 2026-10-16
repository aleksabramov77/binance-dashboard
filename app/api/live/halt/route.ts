import { nextAuth } from "@/app/server/auth";
import { liveHaltAction } from "@/app/server/liveMirror";
import { liveHaltActionSchema } from "@/entities/live-account";
import { withLogging } from "@/shared/lib/route.server";

// Аварийный стоп реального счёта (spec 0049, AC6): «Стоп входов», «Возобновить», «Закрыть всё». Только после входа.
export const POST = withLogging("live.halt", async (request) => {
  const parsed = liveHaltActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Ожидается { action: stop | resume | close_all }" },
      { status: 400 },
    );
  const session = nextAuth ? await nextAuth.auth() : null;
  await liveHaltAction(parsed.data.action, {
    by: session?.user?.login ?? null,
    authEnabled: nextAuth !== null,
  });
  return Response.json({ ok: true });
});
