// Чтение строк experiments построчно (spec 0029): схема конфига строгая, и одна строка с незнакомым полем
// (запись новой версией приложения, ручная правка) не должна ронять тик и страницы — её пропускаем и сообщаем.
// Без @/… и node:* — модуль грузит и Edge Function (Deno) через dbStore.
import {
  type Experiment,
  experimentSchema,
} from "@binance-dashboard/trading-core";

/** Строка experiments, не прошедшая схему: id и пути полей с ошибками. */
export interface InvalidExperimentRow {
  id: string;
  /** «config.marketFiltr — Unrecognized key…; config.maxOpen — …». */
  problem: string;
}

export type OnInvalidExperiment = (row: InvalidExperimentRow) => void;

const rowId = (row: unknown) => {
  const id =
    row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
  return typeof id === "string" && id ? id : "(без id)";
};

/** Строка → эксперимент или null (тогда onInvalid получает id и пути полей). */
export function parseExperimentRow(
  row: unknown,
  onInvalid?: OnInvalidExperiment,
): Experiment | null {
  const parsed = experimentSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  const problem = parsed.error.issues
    .flatMap((issue) =>
      (issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => [...issue.path, key])
        : [issue.path]
      ).map((path) => `${path.map(String).join(".")} — ${issue.message}`),
    )
    .join("; ");
  onInvalid?.({ id: rowId(row), problem });
  return null;
}

/** Строки → эксперименты; невалидные пропускаются и уходят в onInvalid, порядок остальных сохраняется. */
export function parseExperimentRows<Row>(
  rows: readonly Row[],
  onInvalid?: OnInvalidExperiment,
): { experiment: Experiment; row: Row }[] {
  return rows.flatMap((row) => {
    const experiment = parseExperimentRow(row, onInvalid);
    return experiment ? [{ experiment, row }] : [];
  });
}
