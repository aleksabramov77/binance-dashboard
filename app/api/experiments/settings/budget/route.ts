import { setNextBudget } from "@/app/server/experimentSettings";
import { budgetFormSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Стартовый бюджет на эксперимент для следующей эпохи (вступает после сброса).
export const POST = withLogging("experiments.budget", async (request) => {
  const parsed = budgetFormSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Неверный бюджет" },
      { status: 400 },
    );
  return Response.json(await setNextBudget(parsed.data.initialBudget));
});
