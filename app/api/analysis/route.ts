import { setupSchema } from "@/entities/market-signal";
import {
  AnalysisNotConfiguredError,
  analyzeSetup,
} from "@/features/analyze-setup";

export async function POST(request: Request) {
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Некорректный сетап" }, { status: 400 });
  }
  try {
    return Response.json(await analyzeSetup(parsed.data));
  } catch (error) {
    if (error instanceof AnalysisNotConfiguredError) {
      return Response.json(
        { error: error.message, notConfigured: true },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
