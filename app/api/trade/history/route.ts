import { connection } from "next/server";
import { getTradeHistory } from "@/features/execute-trade";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging("trade.history", async () => {
  await connection();
  return Response.json(await getTradeHistory());
});
