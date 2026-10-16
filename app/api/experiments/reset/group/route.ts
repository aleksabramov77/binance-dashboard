import { resetGroupDemo } from "@/app/server/demoMirror";
import { resetGroupCapital } from "@/app/server/experimentSettings";
import { groupResetRequestSchema } from "@/entities/experiment";
import { withLogging } from "@/shared/lib/route.server";

// Сброс группы активов (spec 0038): Paper — «эра группы» без новой эпохи, Demo — демо-позиции и демо-статистика
// экспериментов группы. Другие группы, эпоха и общие сбросы не меняются.
export const POST = withLogging("experiments.reset_group", async (request) => {
  const parsed = groupResetRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      {
        error:
          'Ожидается { market: "spot" | "usdm" | "coinm", account: "paper" | "demo" }',
      },
      { status: 400 },
    );
  const { market, account } = parsed.data;
  if (account === "paper")
    return Response.json(await resetGroupCapital(market));
  const result = await resetGroupDemo(market);
  if ("blocked" in result)
    return Response.json({ error: result.blocked }, { status: 400 });
  return Response.json(result);
});
