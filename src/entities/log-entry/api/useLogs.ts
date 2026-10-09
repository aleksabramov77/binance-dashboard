"use client";

import { useQuery } from "@tanstack/react-query";
import { type LogLevel, logsResponseSchema } from "../model/schema";

async function getLogs(level: LogLevel) {
  const res = await fetch(`/api/logs?level=${level}&limit=300`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Журнал не загрузился (${res.status})`);
  return logsResponseSchema.parse(await res.json()).entries;
}

/** Журнал сервера; обновляется каждые 10 секунд. */
export function useLogs(level: LogLevel) {
  return useQuery({
    queryKey: ["logs", level],
    queryFn: () => getLogs(level),
    refetchInterval: 10_000,
  });
}
