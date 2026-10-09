import { connection } from "next/server";
import { fetchOpenRouterBalance } from "@/shared/api/openrouter";
import { getLlmConfig } from "@/shared/config/env.server";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging(
  "openrouter.balance",
  async () => {
    await connection();
    const config = getLlmConfig();
    if (!config) return Response.json({ configured: false });
    return Response.json({
      configured: true,
      ...(await fetchOpenRouterBalance(config)),
    });
  },
  { quiet: true },
);
