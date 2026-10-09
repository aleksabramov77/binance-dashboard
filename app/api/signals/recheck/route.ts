import { setupSchema } from "@/entities/market-signal";
import { recheckSetup } from "@/features/scan-market";

export async function POST(request: Request) {
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Некорректный сетап" }, { status: 400 });
  }
  try {
    return Response.json(await recheckSetup(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
