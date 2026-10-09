"use client";

import { useState } from "react";
import type { LogEntry } from "@/entities/log-entry";
import { cn } from "@/shared/lib";

const LEVEL_TONE: Record<LogEntry["level"], string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-primary",
  error: "text-destructive",
};

function Row({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(entry.data || entry.error);
  return (
    <li className="border-b py-2 text-sm last:border-0">
      <button
        type="button"
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
        onClick={() => hasDetails && setOpen(!open)}
      >
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
          {new Date(entry.ts).toLocaleTimeString("ru-RU")}
        </span>
        <span
          className={cn(
            "w-14 shrink-0 text-xs font-semibold uppercase",
            LEVEL_TONE[entry.level],
          )}
        >
          {entry.level}
        </span>
        <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground">
          {entry.event}
        </span>
        <span className="min-w-0 flex-1">
          {entry.message}
          {entry.error && (
            <span className="text-destructive"> — {entry.error.message}</span>
          )}
        </span>
        {hasDetails && (
          <span className="text-xs text-muted-foreground">
            {open ? "скрыть" : "детали"}
          </span>
        )}
      </button>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify({ data: entry.data, error: entry.error }, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function LogList({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0)
    return <p className="text-sm text-muted-foreground">Записей нет.</p>;
  return (
    <ul className="rounded-xl border bg-card px-4">
      {entries.map((entry, i) => (
        <Row key={`${entry.ts}-${i}`} entry={entry} />
      ))}
    </ul>
  );
}
