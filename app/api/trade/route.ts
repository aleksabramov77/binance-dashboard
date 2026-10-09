import { connection } from "next/server";
import { tradeRequestSchema } from "@/entities/trade";
import { getTradeOverview, placeTrade } from "@/features/execute-trade";

export async function GET() {
  await connection();
  return Response.json(await getTradeOverview());
}

export async function POST(request: Request) {
  const parsed = tradeRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Некорректная заявка", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    return Response.json(await placeTrade(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
