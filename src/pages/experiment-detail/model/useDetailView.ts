"use client";

import { createParser, useQueryStates } from "nuqs";
import { parseRunParam, type RunParam } from "@/entities/experiment";

/** Период (spec 0046): номер эпохи или all; без параметра — текущая эпоха. */
const runParam = createParser<RunParam>({
  parse: parseRunParam,
  serialize: String,
});

/** Период страницы эксперимента — в URL (?run=). */
export function useDetailView() {
  return useQueryStates({ run: runParam }, { clearOnDefault: true });
}
