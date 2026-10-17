import { setDemoMirrorMode } from "@/app/server/experimentSettings";
import {
  experimentDemoMirrorSchema,
  experimentMirrorModeSchema,
} from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Demo-зеркало эксперимента (spec 008, 0043): положение «Выкл · Авто · Вкл»; «Авто» сразу решает автомат.
// Старый контракт { demoMirror } (вкладка со старой сборкой) — ручное «Вкл» / «Выкл».
export const POST = withLogging("experiments.mirror", async (request) => {
  const body: unknown = await request.json().catch(() => null);
  const parsed = experimentMirrorModeSchema.safeParse(body);
  const legacy = parsed.success
    ? null
    : experimentDemoMirrorSchema.safeParse(body);
  const input = parsed.success
    ? parsed.data
    : legacy?.success
      ? {
          id: legacy.data.id,
          mode: legacy.data.demoMirror ? ("on" as const) : ("off" as const),
        }
      : null;
  if (!input)
    return Response.json(
      { error: 'Ожидается { id: string, mode: "off" | "auto" | "on" }' },
      { status: 400 },
    );
  const settings = await setDemoMirrorMode(input.id, input.mode);
  if (!settings)
    return Response.json(
      { error: `Эксперимент ${input.id} не найден` },
      { status: 404 },
    );
  // Группа не умеет демо-зеркало или «Вкл» без ключа Binance Demo (COIN-M зеркало умеет с spec 0056).
  if ("blocked" in settings)
    return Response.json({ error: settings.blocked }, { status: 400 });
  return Response.json(settings);
});
