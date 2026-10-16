import { connection } from "next/server";
import { getLiveStatusView } from "@/app/server/liveAccount";
import { getLiveTradingView } from "@/app/server/liveMirror";
import { withLogging } from "@/shared/lib/route.server";

// Реальный счёт: последний пульс воркера (spec 0047) и торговля — стоп, позиции, дневные лимиты (spec 0049).
export const GET = withLogging(
  "live.status",
  async () => {
    await connection();
    const [status, trading] = await Promise.all([
      getLiveStatusView(),
      getLiveTradingView(),
    ]);
    return Response.json({ ...status, trading });
  },
  { quiet: true },
);
