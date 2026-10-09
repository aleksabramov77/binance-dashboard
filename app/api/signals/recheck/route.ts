import { setupSchema } from "@/entities/market-signal";
import { recheckSetup } from "@/features/scan-market";
import { withLogging } from "@/shared/lib/route.server";

export const POST = withLogging("signals.recheck", async (request) => {
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Некорректный сетап" }, { status: 400 });
  }
  return Response.json(await recheckSetup(parsed.data));
});
