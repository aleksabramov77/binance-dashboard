import { connection } from "next/server";
import { manualTradeRequestSchema } from "@/entities/trade";
import { getTradeOverview, placeTrade } from "@/features/execute-trade";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("trade.overview", async () => {
  await connection();
  return Response.json(await getTradeOverview());
});

export const POST = withLogging("trade", async (request) => {
  const parsed = manualTradeRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Некорректная заявка", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  return Response.json(await placeTrade(parsed.data));
});
