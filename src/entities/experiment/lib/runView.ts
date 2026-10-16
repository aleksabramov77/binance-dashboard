import { formatDateTime } from "@/shared/lib";
import type { RunParam, RunView } from "../model/view";

// Подписи периода страниц лаборатории (spec 0046): текущая эпоха, прошлая или все эпохи.

type RunInfo = RunView["runs"][number];

/** Пункт выбора эпохи: «Эпоха №2 (текущая)», «Эпоха №1», «Все эпохи». */
export const ALL_RUNS_LABEL = "Все эпохи";

/** Конец эпохи — начало следующей (runs новые сверху); у текущей — null. */
export function runEnd(runs: readonly RunInfo[], id: number): string | null {
  const index = runs.findIndex((r) => r.id === id);
  return index > 0 ? runs[index - 1].startedAt : null;
}

/** Значение выбора: текущая эпоха — null (без ?run= в URL), иначе номер или all. */
export function toRunParam(
  runs: readonly RunInfo[],
  value: number | "all",
): RunParam | null {
  return value === "all" ? "all" : value === runs[0]?.id ? null : value;
}

/** Какой период показан — для подписи под таблицей и в шапке. */
export function describeRunView(view: Pick<RunView, "scope" | "run" | "runs">) {
  if (view.scope === "all") {
    const first = view.runs.at(-1);
    return `${ALL_RUNS_LABEL}${first ? ` с ${formatDateTime(first.startedAt)}` : ""} (${view.runs.length})`;
  }
  const end = runEnd(view.runs, view.run.id);
  return end === null
    ? `Эпоха №${view.run.id} (текущая) с ${formatDateTime(view.run.startedAt)}`
    : `Эпоха №${view.run.id}: ${formatDateTime(view.run.startedAt)} — ${formatDateTime(end)}`;
}
