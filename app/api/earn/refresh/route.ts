import { collectSnapshot } from "@/features/collect-snapshot";

export async function POST() {
  try {
    const { snapshot } = await collectSnapshot();
    return Response.json({
      fetchedAt: snapshot.fetchedAt,
      offers: snapshot.offers.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
