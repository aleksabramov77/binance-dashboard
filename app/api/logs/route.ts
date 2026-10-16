import { connection } from "next/server";
import { readLogs } from "@/app/server/logs";
import { clientErrorSchema, parseLogFilters } from "@/entities/log-entry";
import { getDeploymentVersion } from "@/shared/config/env.server";
import { isStaleVersion } from "@/shared/lib";
import { log } from "@/shared/lib/logger.server";
import { withLogging } from "@/shared/lib/route.server";

export const GET = withLogging(
  "logs",
  async (request) => {
    await connection();
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Number(params.get("limit")) || 300, 1000);
    return Response.json({
      entries: await readLogs(parseLogFilters(params), limit),
    });
  },
  { quiet: true },
);

/**
 * Ошибки из браузера попадают в тот же журнал. Вкладка со старой сборкой (версия ≠ версии сервера)
 * ломается о новый контракт API — это warn `client.stale`, не ошибка прода: монитор считает только error.
 */
export const POST = withLogging(
  "logs.client",
  async (request) => {
    const parsed = clientErrorSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json({ error: "Некорректная запись" }, { status: 400 });
    }
    const { source, message, version, ...rest } = parsed.data;
    const serverVersion = getDeploymentVersion();
    const text = `${source}: ${message}`;
    if (isStaleVersion(version, serverVersion)) {
      log.warn("client.stale", text, {
        source,
        clientVersion: version,
        serverVersion,
        ...rest,
      });
    } else {
      log.error("client", text, { source, version, ...rest });
    }
    return Response.json({ ok: true });
  },
  { quiet: true },
);
