import { collectSnapshot } from "@/features/collect-snapshot";
import { withLogging } from "@/shared/lib/route.server";

export const POST = withLogging("earn.refresh", async () => {
  const { snapshot } = await collectSnapshot();
  return Response.json({
    fetchedAt: snapshot.fetchedAt,
    offers: snapshot.offers.length,
  });
});
