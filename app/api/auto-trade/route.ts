import { connection } from "next/server";
import { setAutoTradeEnabled } from "@/app/server/autoTrade";
import { autoTradeToggleSchema } from "@/entities/trade";
import { getAutoTradeState } from "@/features/auto-trade";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging(
  "auto-trade",
  async () => {
    await connection();
    return Response.json(await getAutoTradeState());
  },
  { quiet: true },
);

export const POST = withLogging("auto-trade.toggle", async (request) => {
  const parsed = autoTradeToggleSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Ожидается { enabled: boolean }" },
      { status: 400 },
    );
  return Response.json(await setAutoTradeEnabled(parsed.data.enabled));
});
