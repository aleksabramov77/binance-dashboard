// План применения решений лаборатории (`pnpm lab:apply`): разбор аргументов и проверка, что изменения не
// противоречат друг другу. Сами записи в БД — scripts/lab-apply.ts через public API entities/experiment.
import type { DemoMirrorMode } from "@/entities/experiment";
import { PRIVATE_ID_PATTERN } from "./labPrivate";

export interface ApplyPlan {
  disable: string[];
  enable: string[];
  /** Положение демо-зеркала (spec 0043): ручные «Вкл» / «Выкл» и «Авто». */
  mirrorOn: string[];
  mirrorOff: string[];
  mirrorAuto: string[];
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
  demoMirrorMode: DemoMirrorMode;
}

export type ApplyChange =
  | { id: string; name: string; field: "enabled"; from: boolean; to: boolean }
  | {
      id: string;
      name: string;
      field: "demoMirrorMode";
      from: DemoMirrorMode;
      to: DemoMirrorMode;
      /** Зеркало сейчас — для «Было» у «Авто» (вкл / выкл). */
      demoMirror: boolean;
    };

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
  "mirror-auto"?: string[];
  "dry-run"?: boolean;
  local?: boolean;
  out?: string;
}): ApplyPlan {
  const plan: ApplyPlan = {
    disable: normalize(values.disable, "--disable"),
    enable: normalize(values.enable, "--enable"),
    mirrorOn: normalize(values["mirror-on"], "--mirror-on"),
    mirrorOff: normalize(values["mirror-off"], "--mirror-off"),
    mirrorAuto: normalize(values["mirror-auto"], "--mirror-auto"),
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
  const twoModes = [
    ...overlap(plan.mirrorAuto, plan.mirrorOn),
    ...overlap(plan.mirrorAuto, plan.mirrorOff),
  ];
  if (twoModes.length)
    throw new Error(
      `противоречие: ${twoModes.join(", ")} — два положения демо-зеркала сразу`,
    );
  if (
    !plan.disable.length &&
    !plan.enable.length &&
    !plan.mirrorOn.length &&
    !plan.mirrorOff.length &&
    !plan.mirrorAuto.length
  )
    throw new Error(
      "нечего применять: --disable, --enable, --mirror-on, --mirror-off или --mirror-auto <id>",
    );
  return plan;
}

/** Что реально поменяется: неизвестный id — ошибка, уже в нужном состоянии — пропуск. */
export function diffApply(
  plan: ApplyPlan,
  current: ApplyFlags[],
): ApplyChange[] {
  const byId = new Map(current.map((e) => [e.id, e]));
  const find = (id: string) => {
    const e = byId.get(id);
    if (!e) throw new Error(`эксперимента ${id} нет в БД`);
    return e;
  };
  const changes: ApplyChange[] = [];
  const enabled = (ids: string[], to: boolean) => {
    for (const id of ids) {
      const e = find(id);
      if (e.enabled !== to)
        changes.push({
          id,
          name: e.name,
          field: "enabled",
          from: e.enabled,
          to,
        });
    }
  };
  const mode = (ids: string[], to: DemoMirrorMode) => {
    for (const id of ids) {
      const e = find(id);
      if (e.demoMirrorMode !== to)
        changes.push({
          id,
          name: e.name,
          field: "demoMirrorMode",
          from: e.demoMirrorMode,
          to,
          demoMirror: e.demoMirror,
        });
    }
  };
  enabled(plan.disable, false);
  enabled(plan.enable, true);
  mode(plan.mirrorOff, "off");
  mode(plan.mirrorOn, "on");
  mode(plan.mirrorAuto, "auto");
  return changes;
}

const MODE_LABEL: Record<DemoMirrorMode, string> = {
  off: "Выкл (вручную)",
  auto: "Авто",
  on: "Вкл (вручную)",
};

const cells = (c: ApplyChange): [string, string, string] =>
  c.field === "enabled"
    ? [
        "эксперимент",
        c.from ? "включён" : "выключен",
        c.to ? "включён" : "выключен",
      ]
    : [
        "демо-зеркало",
        c.from === "auto"
          ? `Авто · ${c.demoMirror ? "вкл" : "выкл"}`
          : MODE_LABEL[c.from],
        c.to === "auto" ? "Авто (решит автомат)" : MODE_LABEL[c.to],
      ];

/** notes — что сразу решил автомат для переведённых в «Авто» (строки как в журнале). */
export function renderApplyMarkdown(
  at: string,
  database: string,
  changes: ApplyChange[],
  dryRun: boolean,
  notes: string[] = [],
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
    ...changes.map((c) => `| ${c.id} | ${c.name} | ${cells(c).join(" | ")} |`),
    "",
    ...(notes.length
      ? [
          "Авто-зеркало сразу после перевода в «Авто»:",
          "",
          ...notes.map((n) => `- ${n}`),
          "",
        ]
      : []),
  ].join("\n");
}
