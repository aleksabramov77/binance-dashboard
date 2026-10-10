import { connection } from "next/server";
import { readLogs } from "@/app/server/logs";
import { clientErrorSchema, LOG_LEVELS } from "@/entities/log-entry";
import { log } from "@/shared/lib/logger.server";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging(
  "logs",
  async (request) => {
    await connection();
    const params = new URL(request.url).searchParams;
    const level = LOG_LEVELS.find((l) => l === params.get("level")) ?? "info";
    const limit = Math.min(Number(params.get("limit")) || 300, 1000);
    return Response.json({ entries: await readLogs(level, limit) });
  },
  { quiet: true },
);

/** Ошибки из браузера попадают в тот же журнал. */
export const POST = withLogging(
  "logs.client",
  async (request) => {
    const parsed = clientErrorSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json({ error: "Некорректная запись" }, { status: 400 });
    }
    const { source, message, ...rest } = parsed.data;
    log.error("client", `${source}: ${message}`, { source, ...rest });
    return Response.json({ ok: true });
  },
  { quiet: true },
);
