import { connection } from "next/server";
import { getLiveStatusView } from "@/app/server/liveAccount";
import { withLogging } from "@/shared/lib/route.server";

// Последний пульс воркера реального счёта — карточка «Реальный счёт» на /settings (spec 0047, AC5).
export const GET = withLogging(
  "live.status",
  async () => {
    await connection();
    return Response.json(await getLiveStatusView());
  },
  { quiet: true },
);
