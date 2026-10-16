// План применения решений лаборатории (`pnpm lab:apply`): разбор аргументов и проверка, что изменения не
// противоречат друг другу. Сами записи в БД — scripts/lab-apply.ts через public API entities/experiment.
import { PRIVATE_ID_PATTERN } from "./labPrivate";

export interface ApplyPlan {
  disable: string[];
  enable: string[];
  mirrorOn: string[];
  mirrorOff: string[];
  dryRun: boolean;
  /** Разрешить запись в локальную PGlite (без DATABASE_URL); иначе скрипт отказывается — это не прод. */
  local: boolean;
  /** Каталог прогона: туда дописывается apply.md. */
  out?: string;
}

export interface ApplyFlags {
  id: string;
  name: string;
  enabled: boolean;
  demoMirror: boolean;
}

export interface ApplyChange {
  id: string;
  name: string;
  field: "enabled" | "demoMirror";
  from: boolean;
  to: boolean;
}

/** id каталога (S01…, F01…); приватные (PS01, PF01, PC01) — формат lab:private, общий PRIVATE_ID_PATTERN. */
const CATALOG_ID = /^[SF]\d{2}$/;
const isExperimentId = (id: string) =>
  CATALOG_ID.test(id) || PRIVATE_ID_PATTERN.test(id);

const normalize = (ids: string[] | undefined, flag: string): string[] => {
  const out = [...new Set((ids ?? []).map((id) => id.trim().toUpperCase()))];
  for (const id of out)
    if (!isExperimentId(id))
      throw new Error(
        `${flag}: «${id}» — не похоже на id эксперимента: каталог S01…F20, приватные PS01, PF01, PC01`,
      );
  return out;
};

const overlap = (a: string[], b: string[]) => a.filter((id) => b.includes(id));

/** Значения node:util parseArgs → план; бросает понятную ошибку при пустом или противоречивом наборе. */
export function planApply(values: {
  disable?: string[];
  enable?: string[];
  "mirror-on"?: string[];
  "mirror-off"?: string[];
  "dry-run"?: boolean;
  local?: boolean;
  out?: string;
}): ApplyPlan {
  const plan: ApplyPlan = {
    disable: normalize(values.disable, "--disable"),
    enable: normalize(values.enable, "--enable"),
    mirrorOn: normalize(values["mirror-on"], "--mirror-on"),
    mirrorOff: normalize(values["mirror-off"], "--mirror-off"),
    dryRun: values["dry-run"] ?? false,
    local: values.local ?? false,
    out: values.out,
  };
  const both = [
    ...overlap(plan.disable, plan.enable),
    ...overlap(plan.mirrorOn, plan.mirrorOff),
  ];
  if (both.length)
    throw new Error(`противоречие: ${both.join(", ")} и включить, и выключить`);
  if (
    !plan.disable.length &&
    !plan.enable.length &&
    !plan.mirrorOn.length &&
    !plan.mirrorOff.length
  )
    throw new Error(
      "нечего применять: --disable, --enable, --mirror-on или --mirror-off <id>",
    );
  return plan;
}

/** Что реально поменяется: неизвестный id — ошибка, уже в нужном состоянии — пропуск. */
export function diffApply(
  plan: ApplyPlan,
  current: ApplyFlags[],
): ApplyChange[] {
  const byId = new Map(current.map((e) => [e.id, e]));
  const changes: ApplyChange[] = [];
  const want = (ids: string[], field: ApplyChange["field"], to: boolean) => {
    for (const id of ids) {
      const e = byId.get(id);
      if (!e) throw new Error(`эксперимента ${id} нет в БД`);
      const from = e[field];
      if (from !== to) changes.push({ id, name: e.name, field, from, to });
    }
  };
  want(plan.disable, "enabled", false);
  want(plan.enable, "enabled", true);
  want(plan.mirrorOff, "demoMirror", false);
  want(plan.mirrorOn, "demoMirror", true);
  return changes;
}

const FIELD_LABEL: Record<ApplyChange["field"], string> = {
  enabled: "эксперимент",
  demoMirror: "демо-зеркало",
};

const state = (c: ApplyChange, v: boolean) =>
  c.field === "enabled"
    ? v
      ? "включён"
      : "выключен"
    : v
      ? "включено"
      : "выключено";

export function renderApplyMarkdown(
  at: string,
  database: string,
  changes: ApplyChange[],
  dryRun: boolean,
): string {
  const title = `## ${at}${dryRun ? " (dry-run, не применено)" : ""}`;
  const head = [title, "", `БД: ${database}.`, ""];
  if (!changes.length)
    return [...head, "Изменений нет — всё уже в нужном состоянии.", ""].join(
      "\n",
    );
  return [
    ...head,
    "| id | Эксперимент | Что | Было | Стало |",
    "|---|---|---|---|---|",
    ...changes.map(
      (c) =>
        `| ${c.id} | ${c.name} | ${FIELD_LABEL[c.field]} | ${state(c, c.from)} | ${state(c, c.to)} |`,
    ),
    "",
  ].join("\n");
}
