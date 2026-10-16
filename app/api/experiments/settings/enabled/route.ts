import { toggleExperiment } from "@/app/server/experimentSettings";
import {
  type ExperimentEnabledState,
  experimentEnabledSchema,
} from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Вкл/выкл отдельного эксперимента: выключенный не открывает новые сделки. Выключение — с категорией причины
// (spec 0046); контрольный с включёнными вариантами — только с confirmControl: true (иначе 409 со списком).
export const POST = withLogging("experiments.enabled", async (request) => {
  const parsed = experimentEnabledSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      {
        error:
          "Ожидается { id: string, enabled: boolean, reason?, note? (до 200 символов), confirmControl? }",
      },
      { status: 400 },
    );
  const { id, enabled, reason, note, confirmControl } = parsed.data;
  const state: ExperimentEnabledState | null = enabled
    ? { enabled: true }
    : reason
      ? { enabled: false, reason, note }
      : null;
  if (!state)
    return Response.json(
      { error: "Выключение — только с причиной: укажите категорию (reason)" },
      { status: 400 },
    );
  const result = await toggleExperiment(id, state, confirmControl ?? false);
  if (!result)
    return Response.json(
      { error: `Эксперимент ${id} не найден` },
      { status: 404 },
    );
  if ("variants" in result)
    return Response.json(
      {
        error: `${id} — контрольный для ${result.variants.join(", ")}: без него варианты не с чем сравнивать. Выключить — только с confirmControl: true`,
        variants: result.variants,
      },
      { status: 409 },
    );
  return Response.json(result);
});
