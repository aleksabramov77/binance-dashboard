"use client";

import { cn } from "@/shared/lib";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ALL_RUNS_LABEL, toRunParam } from "../lib/runView";
import type { RunParam, RunView } from "../model/view";

const ALL = "all";

/**
 * Выбор периода страниц лаборатории (spec 0046): текущая эпоха (по умолчанию), каждая прошлая, «Все эпохи».
 * value — что показано сейчас (view.scope), onChange — новое значение для ?run= (null — текущая).
 */
export function RunSelect({
  view,
  onChange,
  className,
}: {
  view: Pick<RunView, "scope" | "runs">;
  onChange: (run: RunParam | null) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs text-muted-foreground">Эпоха</span>
      <Select
        value={String(view.scope)}
        onValueChange={(v) =>
          onChange(toRunParam(view.runs, v === ALL ? ALL : Number(v)))
        }
      >
        <SelectTrigger size="sm" className="min-w-40" aria-label="Эпоха">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {view.runs.map((r, i) => (
            <SelectItem key={r.id} value={String(r.id)}>
              Эпоха №{r.id}
              {i === 0 ? " (текущая)" : ""}
            </SelectItem>
          ))}
          <SelectItem value={ALL}>{ALL_RUNS_LABEL}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Запрошенной эпохи нет (`?run=` из старой ссылки) — показана текущая. */
export function MissingRunNotice({
  view,
  onReset,
}: {
  view: Pick<RunView, "missingRun" | "run">;
  onReset: () => void;
}) {
  if (view.missingRun === null) return null;
  return (
    <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
      Эпохи №{view.missingRun} нет — показана текущая (№{view.run.id}).{" "}
      <button type="button" className="underline" onClick={onReset}>
        Открыть текущую
      </button>
    </p>
  );
}
